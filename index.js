process.on('unhandledRejection', (reason, p) => {
  console.log({'Unhandled Rejection at': p, reason: reason});
  // application specific logging, throwing an error, or other logic here
});

module.exports = {
	Modem: require("./lib/DigiParser.js"),
	Gateway: require("./lib/WirelessGateway.js")
}
