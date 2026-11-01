export class BridgeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.uncertain = options.uncertain === true;
  }
}

export function insist(condition, code, message) {
  if (!condition) throw new BridgeError(code, message);
}
