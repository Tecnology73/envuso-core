import {StatusCodes} from "http-status-codes";
import {Exception} from "../../Common";

export class InvalidObjectIdUsed extends Exception {
	constructor(entityName: string) {
		super(`Model(${entityName}} cannot be loaded with an invalid object id`);
		this.code = StatusCodes.BAD_REQUEST;
	}
}
