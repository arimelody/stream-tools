const params = new URLSearchParams(window.location.search);

function start() {
    pushSystemMessage("Connecting to Server...");

    const ws = new WebSocket("ws://" + window.location.host);
    ws.addEventListener("open", () => {
        pushSystemMessage("Connected!");
    });
    ws.addEventListener("message", msg => {
        handleWSMessage(JSON.parse(msg.data));
    });
    ws.addEventListener("close", () => {
        console.log("Websocket connection closed.");
    });
    ws.addEventListener("error", err => {
        console.error(err);
    });
}

function handleWSMessage(data) {
    switch (data.type) {
        case 'message':
            pushMessage(
                data.message.name,
                data.message.avatar,
                data.message.colour,
                data.message.text,
            );
            window.scrollTo(0, document.body.scrollHeight);
            break;
        case 'system':
            pushSystemMessage(data.message);
            window.scrollTo(0, document.body.scrollHeight);
            break;
        default:
            console.warn("Received unknown message type \"" + data.type + "\".");
            console.log(data);
            break;
    }
}

function pushSystemMessage(content) {
    if (params.get("system") == "false") return;

    console.log("<SYSTEM> " + content);

    const container = document.createElement("p");
    container.className = "system-message";

    const username = document.createElement("span");
    username.className = "chat-username";
    username.innerText = "SYSTEM";

    const contentSpan = document.createElement("span");
    contentSpan.className = "chat-content";
    contentSpan.innerText = content;

    container.appendChild(username);
    container.appendChild(contentSpan);

    document.getElementById("chat").appendChild(container);
}

function pushMessage(username, avatarURL, colour, content) {
    console.log(`<${username}> ${content}`);

    const container = document.createElement("p");
    container.className = "chat-message";

    const avatar = document.createElement("img");
    avatar.className = "chat-avatar";
    avatar.src = avatarURL;

    const usernameSpan = document.createElement("span");
    usernameSpan.className = "chat-username";
    usernameSpan.innerText = username;
    usernameSpan.style.setProperty("--colour", colour); // #ff00ff
    usernameSpan.style.setProperty("--glow_colour", colour + "80"); // #ff00ff80

    const contentSpan = document.createElement("span");
    contentSpan.className = "chat-content";
    contentSpan.innerText = content;

    container.appendChild(avatar);
    container.appendChild(usernameSpan);
    container.appendChild(contentSpan);

    document.getElementById("chat").appendChild(container);
}

start();
