const dotenv = require("dotenv").config({
  silent: process.env.NODE_ENV === "production"
});

const package = require("./package.json");
const debug = require("debug")(`${package.name}:index`);
const s3o = require("@financial-times/s3o-middleware");
const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();
const helmet = require("helmet");
const express_enforces_ssl = require("express-enforces-ssl");

const bodyParser = require('body-parser');
// support parsing of application/json type post data
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


if (process.env.NODE_ENV === "production") {
  app.use(helmet());
  app.enable("trust proxy");
  app.use(express_enforces_ssl());

  const googleTokenPath = path.resolve(`${__dirname}/keyfile.json`);
  fs.writeFileSync(googleTokenPath, process.env.GOOGLE_CREDS);
}

const validateRequest = require("./helpers/check-token");
const articles = require("./routes/articles");
const twentyfourhrs = require("./routes/twentyfourhrs");
const facetHistory = require("./routes/facetHistory");
const lantern = require("./routes/lantern");
const list = require("./routes/list");
const timeline = require("./routes/timeline");
const facetsWithArticles = require("./routes/facetsWithArticles");
const heartbeat = require("./routes/heartbeat");
const hierarchicalEdgeBundling = require("./routes/hierarchicalEdgeBundling");
const tinder = require("./routes/tinder");
const spaceUtilisation = require("./routes/spaceUtilisation");
const ftMaps = require("./routes/ftMaps");
const ftabulous = require("./routes/ftabulous");
const sapiV1CapiV2 = require("./routes/sapiV1CapiV2");
const ame = require("./routes/aggregatedMetadataExperiments");
const testRoute = require("./routes/sapiV1CapiV2");

const hbs = require("hbs");

hbs.registerPartials(path.resolve(__dirname + '/views/partials/'));

hbs.registerHelper("imgPath", function(path) {
  return path.split("?")[0] + "?source=search";
});

hbs.registerHelper("json", function(context) {
  return JSON.stringify(context);
});

// view engine setup
app.set("views", path.resolve(path.join(__dirname, 'views')));
app.set("view engine", "hbs");

let requestLogger = function(req, res, next) {
  debug("RECEIVED REQUEST:", req.method, req.url);
  next(); // Passing the request to the next handler in the stack.
};

app.use(requestLogger);

// these routes do *not* have s3o
app.use("/static", express.static((path.resolve(__dirname + '/static'))));

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  throw new Error("ERROR: TOKEN not specified in env");
}

// these route *do* use s3o
app.set("json spaces", 2);
if (process.env.BYPASS_TOKEN !== "true") {
  app.use(validateRequest);
}

//Core Routes
app.use(s3o);
app.use("/articles/", articles);
app.use("/24hrs/", twentyfourhrs);
app.use("/facethistory/", facetHistory);
app.use("/lantern/", lantern);
app.use("/list/", list);
app.use("/timeline/", timeline);
app.use("/facetsWithArticles/", facetsWithArticles);
app.use("/heartbeat/", heartbeat);
app.use("/hierarchicalEdgeBundling/", hierarchicalEdgeBundling);
app.use("/tinder/", tinder);
app.use("/space/", spaceUtilisation);
app.use("/ftMaps/", ftMaps);
app.use("/ftabulous/", ftabulous);
app.use("/ame/", ame);
app.use("/sapiV1CapiV2/", sapiV1CapiV2);
app.use("/testRoute/", testRoute);

// ---

app.use("/", (req, res) => {
  res.render("index");
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

const PORT = process.env.PORT;
if (!PORT) {
  throw new Error("ERROR: PORT not specified in env");
}

const server = app.listen(PORT, function() {
  console.log("Server is listening on port", PORT);
});

module.exports = server;
