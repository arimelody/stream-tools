import http from "http";
import fs from "fs";
import { WebSocket, WebSocketServer } from "ws";
import path from "path";

const BASE_URL = "https://api.twitch.tv";
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const BROADCASTER_NAME = process.env.TWITCH_BROADCASTER;
const STATIC_DIR = path.join(import.meta.dirname, "static");

let BOT_TOKEN = process.env.TWITCH_BOT_TOKEN;
let REFRESH_TOKEN = "";
let CSRF_STATE = generateCSRFToken();

let ws;
let wss;
let clients = [];
let broadcasterInfo;
let botInfo;
let avatarCache = {};

const mimeTypes = {
    "html": "text/html",
    "css": "text/css",
    "js": "application/javascript",
    "png": "image/png",
};

const PORT = 8080;

function start() {
    if (!CLIENT_ID) {
        console.error("TWITCH_CLIENT_ID not provided! Exiting...");
        process.exit(1);
    }
    if (!CLIENT_SECRET) {
        console.error("TWITCH_CLIENT_SECRET not provided! Exiting...");
        process.exit(1);
    }
    if (!BROADCASTER_NAME) {
        console.error("BROADCASTER_NAME not provided! Exiting...");
        process.exit(1);
    }

    const server = http.createServer((req, res) => {
        log_request(req, res, handler)
    })
    server.listen(PORT);

    startWebsocketServer(server);

    if (!BOT_TOKEN) {
        console.log(
            "This software requires a Twitch bot/user account to function.\n" +
            `Please go to http://localhost:${PORT} to log in with your bot/user account.`,
        );
    }
}

async function handler(req, res) {
    if (req.url == "/") {
        if (!BOT_TOKEN) {
            res.writeHead(307, {
                "Location": getOAuth2URL(),
            });
            res.end();
            return;
        }
        res.writeHead(200, {"Content-Type": "text/html"});
        res.write("<p>Already authenticated!</p>");
        res.write("<a href=\"" + getOAuth2URL() + "\">Log in with another account</a>");
        res.end();
        return;
    }

    if (req.url.startsWith("/?")) {
        await handleOAuth(req, res);
        return;
    }

    if (req.url.split("?")[0] == "/chat") {
        const filepath = path.join(import.meta.dirname, "views", "chat.html");
        fs.readFile(filepath, (err, data) => {
            if (err) {
                res.writeHead(404, {"Content-Type": "text/plain"});
                res.end("Not Found");
                return;
            }
            res.writeHead(200, {"Content-Type": "text/html"});
            res.write(data);
            res.end();
        });
        return;
    }

    var filepath = path.join(STATIC_DIR, req.url.split("?")[0]);
    if (!filepath.startsWith(STATIC_DIR)) {
        res.writeHead(404, {"Content-Type": "text/plain"});
        res.end("Not Found");
        return;
    }

    fs.readFile(filepath, (err, data) => {
        if (err) {
            res.writeHead(404, {"Content-Type": "text/plain"});
            res.end("Not Found");
            return;
        }

        const ext = filepath.substring(filepath.lastIndexOf(".") + 1);
        res.writeHead(200, {
            "Content-Type": mimeTypes[ext] || "text/plain",
        });
        res.write(data);
        res.end();
    });
}

async function handleOAuth(req, res) {
    const params = new URLSearchParams(req.url.substring(2));
    req.url = "/?code=<redacted>"; // redact from logs
    const code = params.get("code");
    const state = params.get("state");
    if (!code) {
        res.writeHead(400, {"Content-Type": "text/html"});
        res.write("<p>No code provided.</p>");
        res.write("<a href=\"/\">Log in with Twitch</a>");
        res.end();
        return;
    }
    if (state != CSRF_STATE) {
        res.writeHead(400, {"Content-Type": "text/html"});
        res.write("<p>CSRF state mismatch. This is a very bad thing probably!</p>");
        res.write("<a href=\"/\">Log in with Twitch</a>");
        res.end();
        return;
    }

    const oAuthResponse = await getOAuthToken(CLIENT_ID, CLIENT_SECRET, code);
    BOT_TOKEN = oAuthResponse.access_token;
    REFRESH_TOKEN = oAuthResponse.refresh_token;
    CSRF_STATE = generateCSRFToken();
    broadcasterInfo = (await getUsers(CLIENT_ID, BOT_TOKEN, BROADCASTER_NAME))[0];
    botInfo = (await getUsers(CLIENT_ID, BOT_TOKEN, null))[0];

    console.log("Bot token assigned!");

    startWebsocket();

    res.writeHead(200, {"Content-Type": "text/html"});
    res.write("<p>Authenticated! You may now close this tab.</p>");
    res.write("<p>Alternatively, <a href=\"" + getOAuth2URL() + "\">log in with another account</a></p>");
    res.end();
}

async function startWebsocket() {
    if (ws) ws.close();
    ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
    ws.addEventListener("open", () => {
        console.log("Twitch websocket open!");
    });
    ws.addEventListener("message", msg => {
        handleWSMessage(JSON.parse(msg.data.toString()))
    });
    ws.addEventListener("close", () => {
        console.log("Twitch websocket closed.");
    });
    ws.addEventListener("error", err => {
        console.error(err);
    });
}

async function startWebsocketServer(server) {
    wss = new WebSocketServer({server: server});
    wss.on("connection", client => {
        console.log("New websocket client connected.");
        clients.push(client);

        if (!BOT_TOKEN) {
            client.send(JSON.stringify({
                type: "system",
                message: "Server has not been configured. Check the server console for details.",
            }));
        }

        client.on("close", () => {
            console.log("Websocket client disconnected.");
            clients = clients.filter(c => c != client);
        });
    });
}

async function handleWSMessage(data) {
    switch (data.metadata.message_type) {
        case 'session_welcome':
            hookWSSubscriptions(data.payload.session.id)
        case 'notification':
            switch(data.metadata.subscription_type) {
                case 'channel.chat.message':
                    let avatarURL = avatarCache[data.payload.event.chatter_user_login]
                    if (!avatarURL) {
                        const CHATTER_INFO = (await getUsers(
                            CLIENT_ID,
                            BOT_TOKEN,
                            data.payload.event.chatter_user_login)
                        )[0];
                        avatarCache[CHATTER_INFO.login] = CHATTER_INFO.profile_image_url;
                        avatarURL = CHATTER_INFO.profile_image_url;
                    }
                    console.log(`<${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`);
                    clients.forEach(client => {
                        client.send(JSON.stringify({
                            type: "message",
                            message: {
                                name: data.payload.event.chatter_user_name,
                                avatar: avatarURL,
                                colour: data.payload.event.color,
                                text: data.payload.event.message.text,
                            },
                        }));
                    });
            }
    }
}

async function hookWSSubscriptions(sessionID) {
    // chat subscription
    const res = await fetch(BASE_URL + "/helix/eventsub/subscriptions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + BOT_TOKEN,
            "Client-Id": CLIENT_ID,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "type": "channel.chat.message",
            "version": "1",
            "condition": {
                "broadcaster_user_id": broadcasterInfo.id,
                "user_id": botInfo.id,
            },
            "transport": {
                "method": "websocket",
                "session_id": sessionID,
            }
        }),
    });

    if (res.ok) {
        console.log("Connected to stream chat for " + broadcasterInfo.login + ".");
        clients.forEach(client => {
            client.send(JSON.stringify({
                type: "system",
                message: "Connected to stream chat for " + broadcasterInfo.login + ".",
            }));
        });
    } else {
        const data = await res.json();
        console.error("Failed to connect to stream chat for " + broadcasterInfo.login + ".");
        console.error(JSON.stringify(data));
    }
}

async function getOAuthToken(clientID, clientSecret, code) {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "client_id=" + clientID +
        "&client_secret=" + clientSecret +
        "&code=" + code +
        "&grant_type=authorization_code" +
        "&redirect_uri=http://localhost:" + PORT,
    });
    return await res.json();
}

async function getUsers(clientID, token, username) {
    let url = BASE_URL + "/helix/users";
    if (username) url += "?login=" + username;
    const res = await fetch(url, {
        headers: {
            "Authorization": "Bearer " + token,
            "Client-Id": clientID,
        }
    });
    const json = await res.json();
    return json.data;
}

function generateCSRFToken() {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const length = 32;
    let res = "";
    for (let i = 0; i < length; i++)
        res += chars[Math.floor(Math.random() * chars.length)];
    return res;
}

function getOAuth2URL() {
    return "https://id.twitch.tv/oauth2/authorize" +
        "?response_type=code" +
        "&client_id=" + CLIENT_ID +
        "&force_verify=true" +
        "&redirect_uri=http://localhost:" + PORT +
        "&scope=user:read:chat" +
        "&state=" + CSRF_STATE;
}

async function log_request(req, res, handler) {
    const startTime = new Date().getTime();
    await handler(req, res);
    const elapsed = new Date().getTime() - startTime;
    console.log(
        `[${new Date().toISOString()}]`,
        req.method, req.url, "-",
        res.statusCode, "-",
        req.socket.remoteAddress, "-",
        `${elapsed}ms`
    );
}

start();
