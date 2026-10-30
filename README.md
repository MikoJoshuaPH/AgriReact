# AgriTrace frontend

The frontend is served by React and Vite. Existing page templates and their
browser-side behavior are retained in `src/legacy` and rendered by the React
page component.

From this directory, run:

```sh
npm install
npm run dev
```

The canonical browser URLs are `/` (login), `/dashboard`, `/profile`, and
`/admin`. The previous `.html` URLs remain compatible and are normalized to
these clean paths by the app. The app continues to use the same browser page
layout while authentication and the admin database view use the AgriTrace PHP
API.

The frontend connection is configured in `.env`. Copy `.env.example` to `.env`
when setting up a new machine. Browser requests use `VITE_API_BASE_URL=/api`,
while Vite proxies `/api` and `/uploads` to the backend target configured by
`AGRITRACE_BACKEND_URL` and `AGRITRACE_BACKEND_PATH`.

Sign in or register through the login page. The admin database endpoint is
`GET /api/admin/database` and requires a valid JWT for a user with the `admin`
role. It returns live counts and up to the 100 most recent records from each
traceability table. Sensitive password hashes and QR tokens are not included.

Authenticated profile pages use `GET /api/profile` and
`PUT /api/update/{id}`. The backend also exposes authenticated CRUD endpoints
for `/api/farms`, `/api/products`, `/api/batches`, `/api/harvests`,
`/api/shipments`, `/api/markets`, and `/api/notifications`. List responses use
the shape `{ "data": [] }`; create, update, and delete operations return a
message and the affected record where applicable.

Community content uses the authenticated `/api/marketplace` and `/api/posts`
endpoints. `GET` requests load marketplace listings and homepage posts. The
dashboard's Sell Product form creates a marketplace listing and a linked
homepage post together, while the text post form creates a regular community
post. Run the AgriTrace migration command after deploying the backend so the
`marketplace_listings` and `community_posts` tables are created.


## Running against the backend

Start the LavaLust API first, for example `php -S 127.0.0.1:8080 -t public public/index.php` from the `AgriTrace` folder, after running the migrations (`php lava migration run`).

The default proxy target is the local Laragon backend at
`http://127.0.0.1/finalproject/AgriTrace/public`. For a Laragon install, run:

```sh
npm run dev
```

For the PHP built-in server, use:

```sh
AGRITRACE_BACKEND_URL=http://127.0.0.1:8080 AGRITRACE_BACKEND_PATH= npm run dev
```

Production builds use the `VITE_API_BASE_URL` value (default `/api`).
When the frontend is hosted separately in production, set
`VITE_API_BASE_URL` to the complete backend API URL, such as
`https://api.example.com/api`, and configure the backend CORS allowed origin for
the frontend origin.

New accounts are inactive until an administrator approves them. Products and community posts from non-admin users are also held for approval before they appear publicly.

## Google and Facebook sign-in

Add the provider credentials to `AgriTrace/.env`:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
```

In the Google and Meta developer consoles, allow the matching callback URI:

- Google: `http://localhost:5173/api/oauth/google/callback`
- Facebook: `http://localhost:5173/api/oauth/facebook/callback`

These local callback URLs use the Vite `/api` proxy. For deployment, register
the public callback URL formed from `APP_PUBLIC_URL` and
`/api/oauth/{google|facebook}/callback` instead. Set `APP_PUBLIC_URL` to that
public API/proxy origin and `APP_FRONTEND_URL` to the frontend origin. Provider
credentials are required; the login buttons cannot complete sign-in without
them.
