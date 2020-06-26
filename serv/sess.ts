import * as express from 'express';

// import {IUser} from '../models/user';
interface IUser {
    
}

interface IReqSession {
    user?: IUser
}

declare module "express-serve-static-core" {
    interface Request {
        session: IReqSession
    }
}

export default function createSesssionObject(): express.RequestHandler {
    return (req, resp, next) => {
        req.session = {};
        next();
    };
}