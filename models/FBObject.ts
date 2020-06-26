export class FBObject {
    toJSON() {
        return JSON.parse(JSON.stringify(Object.assign({}, this)));
    }
}

export default FBObject;