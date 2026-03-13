module.exports = async (req, res) => {
  const mod = await import("../Backend/server.js");
  return mod.default(req, res);
};
