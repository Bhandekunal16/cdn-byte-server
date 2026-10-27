const { middleware, errorMiddleware } = require("../../middleware.loader");
const { express } = require("../../provider/dependency.map");

function bootstrap() {
  const app = express();

  middleware(app);

  const activeRequests = new Set();

  app.use((_, res, next) => {
    activeRequests.add(res);

    const release = () => {
      activeRequests.delete(res);
    };

    res.once("finish", release);
    res.once("close", release);

    next();
  });

  app.get("/", (_, res) => {
    res.json({
      message: "hello world",
    });
  });

  app.use((_, res) => {
    res.status(404).json({
      status: false,
      statusCode: 404,
      message: "Not Found",
    });
  });

  return { app, activeRequests };
}

function registerErrorMiddleware(app) {
  errorMiddleware(app);
}

module.exports = { bootstrap, registerErrorMiddleware };
