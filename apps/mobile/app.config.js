// EXPO_PUBLIC_ANTLER_SERVER_URL is a public endpoint, never a credential.
const base = require("./app.json");
const bundle = require("./bundle-version.json");
const buildEnvironment = process.env.ANTLER_MOBILE_ENV ?? "production";
if (!["development", "test", "production"].includes(buildEnvironment))
  throw new Error("Invalid ANTLER_MOBILE_ENV");
const development = buildEnvironment !== "production";
const serverUrl =
  process.env.EXPO_PUBLIC_ANTLER_SERVER_URL ??
  (buildEnvironment === "production" ? "https://chat.xiaoanai.top" : "");
let httpHost;
if (serverUrl) {
  let endpoint;
  try {
    endpoint = new URL(serverUrl);
  } catch {
    throw new Error("Invalid mobile backend URL");
  }
  if (
    (endpoint.protocol !== "https:" &&
      !(development && endpoint.protocol === "http:")) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      "Invalid mobile backend URL: use an allowed URL without credentials, query or fragment",
    );
  if (development && endpoint.protocol === "http:")
    httpHost = endpoint.hostname;
}
module.exports = {
  ...base.expo,
  extra: {
    ...base.expo.extra,
    bundleVersion: bundle.version,
    serverUrl,
    allowHttp: development,
    automationEnabled:
      development && process.env.ANTLER_MOBILE_AUTOMATION === "true",
  },
  ios: {
    ...base.expo.ios,
    infoPlist: {
      ...base.expo.ios.infoPlist,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: development,
        ...(httpHost
          ? {
              NSExceptionDomains: {
                [httpHost]: {
                  NSExceptionAllowsInsecureHTTPLoads: true,
                  NSIncludesSubdomains: false,
                },
              },
            }
          : {}),
      },
    },
  },
  plugins: [
    "expo-router",
    ...(base.expo.plugins ?? []),
    ["./with-network-policy", { allowHttp: development }],
  ],
};
