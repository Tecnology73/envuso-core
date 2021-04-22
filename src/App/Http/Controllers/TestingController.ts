import {IsString, MinLength} from "class-validator";
import {Controller, controller, DataTransferObject, dto, get, method, middleware, Middleware, RequestContext, response} from "../../../Routing";
import {User} from "../../Models/User";
import {TestMiddleware} from "../Middleware/TestMiddleware";
import {TestController} from "./TestController";

class DTO extends DataTransferObject {

	@IsString()
	@MinLength(1)
	something: string;
}


@middleware(new TestMiddleware())
@controller('/testing')
export class TestingController extends Controller {

	private someValue = false;

	constructor(public testController?: TestController) {
		super();
	}

	@method(['POST', 'GET'], '/get')
	async testGet(@dto() dt: DTO) {
		this.someValue = true;

		return this.testController.gimmeInfo();
	}

	@method(['GET', 'PUT'], '/testget')
	async testMethods(@dto() dt: DTO) {

	}

	@get('/rmb/userobject/:user')
	async testRouteModelBinding(user: User) {
		return response().json(user);
	}

	@get('/rmb/userobject/obj/:user')
	async testRouteModelBindingObj(user: User) {
		return user;
	}

	@get('/rmb/uservalsobj/:user')
	async testRouteModelBindingObjValues(user: User) {
		return {_id : user._id};
	}

	@get('/rmb/uservals/:user')
	async testRouteModelBindingValues(user: User) {
		return response().json({_id : user._id});
	}

}
