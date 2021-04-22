import {FastifyReply, FastifyRequest} from "fastify";
import {Log, METADATA} from "../../Common";
import {Model} from "../../Database";
import {MethodParameterDecorator} from "./RequestInjection";
import {Route} from "./Route";
import {param} from "./RouteDecorators";

export class RouteManager {

	/**
	 * Reflect Metadata keys that we'll use for method parameter handling. We
	 * basically iterate through these to see if they're applied to the method
	 * and if they are, it will return a {@see MethodParameterDecorator} instance
	 */
	public static methodParamTypesForInjection(): Array<METADATA> {
		return [
			METADATA.REQUEST_METHOD_DTO,
			METADATA.REQUEST_METHOD_FASTIFY_REQUEST,
			METADATA.REQUEST_METHOD_ROUTE_PARAMETER,
			METADATA.REQUEST_METHOD_QUERY_PARAMETER,
			METADATA.REQUEST_METHOD_BODY,
			METADATA.REQUEST_METHOD_HEADERS
		];
	}

	/**
	 * Parse all of the types for the requested controller method.
	 * We'll then see if we can apply any decorator/DI to these parameters.
	 *
	 * Handles things like Route model binding, dto resolving & validating,
	 * injecting request, response etc.
	 *
	 * @param request
	 * @param response
	 * @param route
	 */
	public static async parametersForRoute(request: FastifyRequest, response: FastifyReply, route: Route) {

		//TODO: Double check we actually need this, pretty sure that
		//We figured out last night that, this was basically useless
		// const parameters = route.getMethodParameterTypes();
		//
		// if (!parameters.length) {
		// 	return [];
		// }

		const parameterArgs = [];

		for (let index in route.methodMeta.parameters) {
			const parameter = route.methodMeta.parameters[index];

			//@TODO: Add route model binding back here...
			if (parameter.type.prototype instanceof Model) {
				const modelInstance: typeof Model = parameter.type;

				const identifier = request.params[parameter.name];
				const model      = await modelInstance.find(identifier) ?? null;

				parameterArgs.push(model);

				continue;
			}

			for (let metadataKey of this.methodParamTypesForInjection()) {

				const methodMeta: MethodParameterDecorator = MethodParameterDecorator.getMethodMetadata(
					route.methodMeta.target[route.methodMeta.key],
					metadataKey
				);

				if (!methodMeta) {
					Log.info('Param ' + route.methodMeta.key + ' doesnt have meta for injector: ' + metadataKey);

					continue;
				}

				const canBind = methodMeta.canBind(
					route.methodMeta.target[route.methodMeta.key],
					parameter.type,
					Number(index)
				);

				if (canBind) {
					parameterArgs.push(await methodMeta.bind(request, response));
					break;
				}
			}

		}

		return parameterArgs;
	}


}
