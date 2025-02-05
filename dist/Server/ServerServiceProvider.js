"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerServiceProvider = void 0;
const AppContainer_1 = require("../AppContainer");
const Server_1 = require("./Server");
const SocketServer_1 = require("../Sockets/SocketServer");
class ServerServiceProvider extends AppContainer_1.ServiceProvider {
    register(app, config) {
        return __awaiter(this, void 0, void 0, function* () {
            app.container().registerSingleton(Server_1.Server);
            app.container().registerSingleton(SocketServer_1.SocketServer);
        });
    }
    boot(app, config) {
        return __awaiter(this, void 0, void 0, function* () {
        });
    }
}
exports.ServerServiceProvider = ServerServiceProvider;
//# sourceMappingURL=ServerServiceProvider.js.map