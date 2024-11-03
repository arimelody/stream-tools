# ari's stream tools

experimenting with the twitch API to make handy streaming tools!

(also featuring the world's most rushed documentation)

## how to run

1. `git clone` this repo and `cd` into it
2. `npm ci` to install dependencies
3. set the following environment variables (it will complain if you don't):
    - `TWITCH_CLIENT_ID`: the client ID for your twitch application
    - `TWITCH_CLIENT_SECRET`: the client secret for your twitch application
    - `BROADCASTER_NAME`: the username of the streamer/broadcaster
4. `npm run start` to start
5. follow instructions in the console to hook up a bot/user account
6. ???
7. profit

## chat

- access via `GET /chat`
- append `?system=false` to hide system messages
- for OBS, consider overriding `body`'s CSS to `background: transparent`

