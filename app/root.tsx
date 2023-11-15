import {
  Links,
  Meta,
  Outlet,
  LiveReload,
  Scripts,
  useLoaderData,
} from "@remix-run/react";
import { json } from "@remix-run/node";

export const headers = {
  "Cache-Control": "max-age=604800, stale-while-revalidate=86400",
};

export function loader() {
  return json({
    message: "Hello from loader v2",
  });
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  return (
    <html>
      <head>
        <link rel="icon" href="data:image/x-icon;base64,AA" />
        <Meta />
        <Links />
      </head>
      <body>
        <h1>{data.message}</h1>
        <Outlet />

        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
