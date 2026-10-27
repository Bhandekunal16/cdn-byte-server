const { express, cluster, logByte } = require("./provider/dependency.map");
const {
  clusterInterceptor,
  markClusterShuttingDown,
  replicate,
} = require("./provider/interceptor.map");
const {
  host,
  port,
  SHUTDOWN_TIMEOUT,
  REPLICA,
  clustering,
  replicas,
} = require("./provider/config.map");
const { middleware, errorMiddleware } = require("./middleware.loader");
const {
  gracefulShutdown,
  registerClusterPrimaryShutdown,
  registerWorkerShutdownMessage,
  triggerGracefulShutdown,
} = require("./layers/graceful.shutdown.layer");
const userRoutes = require("./routes/user.routes");
const storageRoutes = require("./routes/storage.routes");

if (clustering && cluster.isPrimary) {
  clusterInterceptor();

  registerClusterPrimaryShutdown({
    shutdownTimeout: SHUTDOWN_TIMEOUT,
    markClusterShuttingDown,
  });
} else {
  const app = express();
  const activeRequests = new Set();

  middleware(app);

  app.use((req, res, next) => {
    activeRequests.add(res);

    res.once("finish", () => {
      activeRequests.delete(res);
    });

    res.once("close", () => {
      activeRequests.delete(res);
    });

    next();
  });

  app.get("/", (_, res) => {
    res.json({ message: "hello world" });
  });

  userRoutes(app);
  storageRoutes(app);

  app.use((_, res) => {
    res.status(404).json({
      status: false,
      statusCode: 404,
      message: "Not Found",
    });
  });

  errorMiddleware(app);

  const serverName = clustering ? "Express worker" : "Express";
  const servers = replicate(app, host, port, REPLICA, replicas);

  for (const server of servers) {
    gracefulShutdown({
      server,
      name: serverName,
      shutdownTimeout: SHUTDOWN_TIMEOUT,
      activeRequests,
      onShutdown: () => {
        logByte.warn(`${serverName}: shutdown started`);
      },
    });
  }

  if (clustering) {
    registerWorkerShutdownMessage(() => {
      triggerGracefulShutdown("shutdown");
    });
  }
}
