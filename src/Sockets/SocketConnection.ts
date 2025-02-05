import {IncomingMessage} from "http";
import querystring from "querystring";
import WebSocket from "ws";
import {config, resolve} from "../AppContainer";
import {Auth} from "../Authentication";
import {Authenticatable, Log, Str} from "../Common";
import {Middleware, RequestContext} from "../Routing";
import {parseSocketChannelName, SocketEvents} from "./SocketEvents";
import {SocketChannelListener} from "./SocketChannelListener";
import {SocketListener} from "./SocketListener";
import {SocketPacket} from "./SocketPacket";
import {ChannelInformation} from "./SocketServer";


export class SocketConnection {
	private socket: WebSocket;
	private request: IncomingMessage;
	private token: string;

	public id: string;
	public userId: string;
	public user: Authenticatable<any>;

	private isConnected: boolean;

	/**
	 * The callback for the server so we can remove the connection
	 *
	 * @type {Function}
	 * @private
	 */
	private _onDisconnectCallback: Function;

	private _subscribedChannels: Map<string, SocketChannelListener> = new Map();

	constructor(socket: WebSocket, request: IncomingMessage) {
		this.id          = Str.uniqueRandom(20);
		this.socket      = socket;
		this.request     = request;
		this.isConnected = true;
	}

	/**
	 * Bind all of the default ws event listeners
	 */
	public bindListeners() {

		Log.info(`Socket connected - id: ${this.id} - userId: ${this.userId}`);

		this.socket.on("message", this._handlePacket.bind(this));
		this.socket.on("close", this._onClose.bind(this));
	}

	/**
	 * There are certain "events" that we need to manually handle before they
	 * are delivered to the {@see SocketChannelListener} that the developer defines
	 *
	 * @param {string} data
	 * @returns {Promise<void>}
	 */
	public async _handlePacket(data: string) {
		const packet = JSON.parse(data);

		switch (packet.event) {
			case SocketEvents.SOCKET_PONG:
				this._onPong(data);
				break;
			case SocketEvents.CHANNEL_SUBSCRIBE_REQUEST:
				await this._onChannelSubscribeRequest(packet.data);
				break;
			case SocketEvents.CHANNEL_UNSUBSCRIBE_REQUEST:
				await this._onChannelUnsubscribeRequest(packet.data);
				break;
			default:
				await this._onMessage(packet);
		}
	}

	/**
	 * Process the token from the original connection, setup the
	 * request context, process all global middleware and
	 * then finally, bind all socket listeners
	 */
	public setup(callback: Function) {
		this.handleToken();

		new RequestContext(this.request, undefined, this).bindToSockets(async () => {
			await this.prepareConnection();

			callback(this);
		});
	}

	/**
	 * Send the websocket event to the specified {@see SocketChannelListener}
	 *
	 * @param data
	 * @returns {Promise<void>}
	 * @private
	 */
	private async _onMessage(data) {

		const packet = SocketPacket.createFromReceived(data);

		if (packet.isForChannel()) {
			await this._onChannelMessage(packet);

			return;
		}

		await this._onEventMessage(packet);
	}

	private async _onEventMessage(packet: SocketPacket) {
		const channelInformation: ChannelInformation = {
			channelName           : packet.getEvent(),
			containerListenerName : 'ws:listener:' + packet.getEvent(),
			wildcardValue         : null,
		};

		const listener = resolve<SocketListener>(channelInformation.containerListenerName);

		if (!listener) {
			Log.warn('Received socket event: ' + channelInformation.channelName + '... but no event listener is defined for this event.');

			return;
		}

		await listener.handle(this, this.user, packet);
	}

	private async _onChannelMessage(packet: SocketPacket) {
		const channelInformation = parseSocketChannelName(packet.getChannel());

		const listener = resolve<SocketChannelListener>(channelInformation.containerListenerName);

		if (!this.hasSubscription(listener)) {
			Log.warn("Someone sent a message to a channel that they're not subscribed to...", channelInformation);

			return;
		}

		for (let middleware of listener.middlewares()) {
			await middleware.handle(RequestContext.get());
		}

		if (!listener[packet.getEvent()]) {
			Log.warn('Trying to use event name that is not registered: ' + packet.getEvent());

			return;
		}

		await listener[packet.getEvent()](this, this.user, packet);
	}

	/**
	 * Handle the client sending it's pong back after the server sent ping
	 *
	 * @param data
	 * @private
	 */
	private _onPong(data) {
		Log.info(`Socket pong from: ${this.id} userId: ${this.userId}`);

		this.isConnected = true;
	}

	/**
	 * Client lost connection to server
	 *
	 * @param code
	 * @param reason
	 * @returns {Promise<void>}
	 * @private
	 */
	private async _onClose(code, reason) {
		this.disconnect(reason);
		Log.info('Socket closed...', {code, reason});
	}

	/**
	 * When the client wants to subscribe to a channel, it will send
	 * a socket event to the server asking to connect to x channel
	 *
	 * The server will call "isAuthorised" on the {@see SocketChannelListener}
	 * to determine if x user can use x channel, this allows the
	 * developer to implement their own permissions, and...
	 * finally we'll respond with the status of the request
	 *
	 * @param {any} channel
	 * @returns {Promise<void>}
	 * @private
	 */
	private async _onChannelSubscribeRequest({channel}) {
		const channelInfo = parseSocketChannelName(channel);

		const listener = resolve<SocketChannelListener>(channelInfo.containerListenerName);

		if (!listener) {
			console.error('Listener not found.... ', channelInfo);
			return;
		}

		listener.setChannelInformation(channelInfo);

		const canSubscribe = await listener.isAuthorised(
			this, this.user
		);

		if (canSubscribe) {
			this._subscribedChannels.set(channelInfo.channelName, listener);
		}

		this.send(SocketEvents.CHANNEL_SUBSCRIBE_RESPONSE, {
			channel    : listener.getChannelName(),
			successful : canSubscribe
		});
	}

	/**
	 * The client library can request to unsubscribe from a channel
	 * We'll make sure they have permission to do this, then delete the listener.
	 *
	 * @param {any} channel
	 * @returns {Promise<void>}
	 * @private
	 */
	private async _onChannelUnsubscribeRequest({channel}) {
		const channelInfo = parseSocketChannelName(channel);

		const listener = resolve<SocketChannelListener>(channelInfo.containerListenerName);

		if (!listener) {
			console.error('Listener not found.... ', channelInfo);
			return;
		}

		const subscription = this._subscribedChannels.get(channelInfo.channelName);

		if (!subscription) {
			return;
		}

		const isAuthorised = await subscription.isAuthorised(this, this.user);

		if (!isAuthorised) {
			return;
		}

		this._subscribedChannels.delete(channelInfo.channelName);
	}

	/**
	 * We have to send the token in the query string of the socket url
	 * For the regular {@see JwtAuthenticationMiddleware} to work, we
	 * also need to add this token manually as an authorization header.
	 */
	public handleToken() {
		const query = querystring.parse(querystring.unescape(
			this.request.url.replace('/?', '')
		));

		this.request.headers.authorization = `Bearer ${query.token}`;

		this.token = query.token as string;
	}

	/**
	 * Initialise middlewares defined in the websocket config and prepare them for usage
	 *
	 * @returns {Middleware[]}
	 */
	public getGlobalSocketMiddlewares() {
		const middlewares = config<(new () => Middleware)[]>('websockets.middleware');

		return middlewares.map(m => new m());
	}

	/**
	 * Loop through all middlewares from the config and process them
	 *
	 * @returns {Promise<void>}
	 */
	public async processMiddlewares() {
		for (let middleware of this.getGlobalSocketMiddlewares()) {
			await middleware.handle(RequestContext.get());
		}
	}

	/**
	 * Runs all global middlewares, sets the authenticated
	 * user and runs our ws event listeners
	 *
	 * @returns {Promise<this>}
	 */
	public async prepareConnection() {
		await this.processMiddlewares();

		this.userId = Auth.id();
		this.user   = Auth.user();

		// Assign the connection id to the request
		// So we can track it more efficiently
		this.request.userId       = this.userId;
		this.request.connectionId = this.id;

		this.bindListeners();

		return this;
	}

	/**
	 * Send a custom created socket packet on this connection
	 *
	 * @param {T} packet
	 */
	public sendPacket<T extends SocketPacket>(packet: T) {
		this.socket.send(packet.response());
	}

	/**
	 * Send a socket event to this connection
	 *
	 * @param {SocketEvents} event
	 * @param data
	 */
	public send<T>(event: SocketEvents | string, data: T|any = {}) {
		this.socket.send(
			SocketPacket.create(event, data).response()
		);
	}

	/**
	 * Send a socket event to the channel
	 *
	 * @param {string} channel
	 * @param {SocketEvents | string} event
	 * @param data
	 */
	public sendToChannel<T>(channel: string, event: SocketEvents | string, data: T|any) {
		this.socket.send(
			SocketPacket.createForChannel(channel, event, data).response()
		);
	}

	/**
	 * Disconnect the socket connection
	 *
	 * @param {string} disconnectReason
	 */
	public disconnect(disconnectReason: string) {
		this.socket.terminate();
		this._onDisconnectCallback(this.userId, this.id);
		Log.info('Socket disconnected: ' + disconnectReason, {id : this.id});
	}

	/**
	 * When we send a ping, we'll then set this to false, when
	 * we receive the pong, it will be set to true.
	 *
	 * So that for the next ping send to the connection if it's
	 * still false, we'll disconnect the client because this
	 * means they never responded to the ping
	 */
	public setAwaitingPing() {
		this.isConnected = false;
	}

	/**
	 * Is the client still connected?
	 *
	 * @returns {boolean}
	 */
	didRespondToPing() {
		return this.isConnected;
	}

	/**
	 * We need to use a callback to handle the disconnect logic for this connection in {@see SocketServer}.
	 * When the client disconnects, this callback will be called with the user id and socket id.
	 *
	 * @param {Function} callback
	 */
	public onDisconnect(callback: Function) {
		this._onDisconnectCallback = callback;
	}

	/**
	 * Does a subscription exist for this ChannelListener?
	 *
	 * @param {{new(): SocketChannelListener} | SocketChannelListener} channel
	 * @returns {boolean}
	 */
	hasSubscription(channel: (new() => SocketChannelListener) | SocketChannelListener): boolean {
		const channelInst = (channel instanceof SocketChannelListener) ? channel : new channel();

		return this._subscribedChannels.has(channelInst.channelName());
	}

	/**
	 * Get a socket subscription for the listener
	 *
	 * @param {{new(): SocketChannelListener} | SocketChannelListener} channel
	 * @returns {SocketChannelListener}
	 */
	getSubscription(channel: (new() => SocketChannelListener) | SocketChannelListener): SocketChannelListener {
		const channelInst = (channel instanceof SocketChannelListener) ? channel : new channel();

		return this._subscribedChannels.get(channelInst.channelName());
	}

}
