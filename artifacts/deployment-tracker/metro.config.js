const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const shimPath = path.resolve(__dirname, "shims/react-native-maps.web.tsx");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      filePath: shimPath,
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
