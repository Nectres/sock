import { ServerOptions, WebSocketServer, WebSocket } from "ws"
import { nanoid } from "nanoid"


type Fn = (...args: any[]) => any

type MapIndex = string | number | symbol

interface SockPayload {
    id: string
    type: "result" | "cmd",
    from: string
    to: string | "all"
    event: MapIndex,
    error?: string
    data: any
}

type MethodMap = Record<SockPayload['id'], Fn>

// interface MethodMap extends MethodMap {
//     join?: (id:string) => void
// }

interface SocketClient extends WebSocket {
    id: string
}

type FnKeys<T> = { [K in keyof T]: T[K] extends Fn ? K : never }

class Sock<T extends Record<any, any>> {
    server?: SockServer<T>
    protected resolvePromiseMap: Record<string, Fn>
    protected HandlerMap: Record<MapIndex, Fn>
    isServer: boolean = false;
    serverId: string
    socket: WebSocket
    id: string
    clients: string[]

    constructor(name: string, port: number, isServer: boolean) {
        this.id = nanoid(20);
        this.clients = [this.id];
        this.resolvePromiseMap = {};
        this.serverId = name ?? nanoid(20);
        this.HandlerMap = {}
        if (isServer)
            return;
        this.socket = new WebSocket(`ws://localhost:${port}`);
        this.socket.on("message", async (msg) => {
            let payload = JSON.parse(msg.toString()) as SockPayload;
            if (payload.type == "result")
                return this.resolvePromiseMap[payload.id](...payload.data)
            let result = await this.HandlerMap[payload.event](...payload.data);
            payload.type = "result";
            [payload.from, payload.to] = [payload.to, payload.from];
            payload.data = result;
            payload.type = "result";
            this.socket.send(payload, (err) => {
                if (err)
                    console.error(err);
            })
        })
    }

    protected async _send(payload: SockPayload): Promise<any> {
        return new Promise((res, rej) => {
            this.resolvePromiseMap[payload.id] = res;
            this.socket.send(payload, (err) => {
                if (err)
                    rej(err);
            })
        })
    }

    async waitFor(client: string) {
        return new Promise((res, rej) => {
            if (client in this.clients)
                res(1);
            this.on("join", ((id: string) => client == id ? res(1) : null) as T["join"])
        })
    }

    async send<K extends keyof FnKeys<T>>(event: K, ...args: Parameters<T[K]>): Promise<ReturnType<T[K]>> {
        let payload: SockPayload = {
            from: this.serverId,
            data: args,
            event,
            id: this.serverId,
            type: "cmd",
            to: "all"
        }
        return this._send(payload);
    }

    async sendTo<K extends keyof FnKeys<T>>(event: K, clientId: string, ...args: Parameters<T[K]>): Promise<ReturnType<T[K]>> {
        let payload: SockPayload = {
            from: this.id,
            data: args,
            event,
            id: this.serverId,
            to: clientId,
            type: "cmd",
        }
        return this._send(payload);
    }

    on<K extends keyof FnKeys<T>>(event: K, callback: T[K]) {
        this.HandlerMap[event] = callback;
    }
}

class SockServer<T extends MethodMap> extends Sock<T> {
    id: string
    socketServer: WebSocketServer
    clientMap: Record<string, WebSocket>

    constructor(name: string, options?: ServerOptions) {
        const port = options.port ?? 8933;
        super(name, port, true);
        this.clientMap = {}
        this.socketServer = new WebSocketServer(options)
        // Route traffic
        this.socketServer.on("connection", (client: SocketClient) => {
            client.on("message", async (data) => {
                let payload = JSON.parse(data.toString()) as SockPayload;
                if (payload.to != this.id)
                    this.clientMap[payload.to].send(payload)
                this.socket.emit("message", payload);
            })
        })
    }

    protected async _send(payload: SockPayload, specificClient?: string): Promise<any> {
        return new Promise((res, rej) => {
            this.resolvePromiseMap[payload.id] = res;
            if (specificClient)
                this.clientMap[specificClient].send(payload, (err) => err ? rej(err) : null)
            else
                Object(this.clientMap).map((clientId) => this.clientMap[clientId].send(payload))
        })
    }

}

function createSockServer<T extends MethodMap>(name: string, port: number, options: ServerOptions = {}): Sock<T> {
    options.port = port;
    return new SockServer(name, options);
}

function createSock<T>(name: string, port: number): Sock<T> {
    return new Sock(name, port, false);
}

export { createSockServer, createSock, MethodMap as SockMethods } 