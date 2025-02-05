import {StatusCodes} from "http-status-codes";
import {Exception} from "../../Common";

export class PolicyPermissionNotFound extends Exception {
	constructor(entityName: string, permissionName: string) {
		super(`Model(${entityName}} does not have a method named: ${permissionName}`);
		this.code = StatusCodes.NOT_FOUND;
	}
}
