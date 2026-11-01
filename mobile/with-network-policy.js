const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withNetworkPolicy(config, { allowHttp }) {
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    if (application)
      application.$["android:usesCleartextTraffic"] = allowHttp
        ? "true"
        : "false";
    return result;
  });
};
