const fs = require("fs");
const path = require("path");

const apiFile = path.join(__dirname, "..", "public", "js", "api.js");
const routeFile = path.join(__dirname, "..", "server", "routes", "technicians.js");

const api = fs.readFileSync(apiFile, "utf8");
const route = fs.readFileSync(routeFile, "utf8");

if (!api.includes("updateTechnician: (id, payload) => request(\"PATCH\", `/technicians/${id}`, payload)")) {
  console.error("FAIL: admin technician update API client method is missing");
  process.exit(1);
}

if (!route.includes("router.patch(\"/technicians/:id\", requireAuth([\"admin\"]")) {
  console.error("FAIL: server technician edit route is missing");
  process.exit(1);
}

console.log("PASS: admin technician edit API and route hooks are present");
