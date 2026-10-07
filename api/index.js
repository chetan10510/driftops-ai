import worker from "../worker/index.js";

function routeRequest(request) {
  const url = new URL(request.url);
  const path = url.searchParams.get("__path");
  if (!path) return request;
  url.pathname = `/${path.replace(/^\/+/, "")}`;
  url.searchParams.delete("__path");
  return new Request(url, request);
}

export default {
  fetch(request) {
    return worker.fetch(routeRequest(request), process.env);
  },
};
