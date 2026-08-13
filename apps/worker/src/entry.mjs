#!/usr/bin/env node

import { loadLocalEnvironment } from "./environment.mjs";

loadLocalEnvironment();
await import("./cli.mjs");
