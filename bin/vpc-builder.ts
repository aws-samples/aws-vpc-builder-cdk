#!/usr/bin/env node
import "source-map-support/register";
import { StackBuilderClass } from "../lib/stack-builder";
import { Stack } from "aws-cdk-lib"

(async () => {
  try {
    const stackBuilder = new StackBuilderClass();
    const cdkApp = stackBuilder.stackMapper.app;

    const configFile = cdkApp.node.tryGetContext("config");
    // If a configuration file is provided we will use it to build our stacks
    if (configFile) {
      stackBuilder.configure(configFile);
      await stackBuilder.build();
    } else {
      // When no configuration context provided, we will warn but not fail.  This allows 'cdk bootstrap', 'cdk help'
      // to continue to work as expected.
      const dummyStack = new Stack(cdkApp, 'dummyStack', {})
      console.warn(
          "\nNo configuration provided.  Use a configuration file from the 'config' directory using the '-c config=[filename]' argument\n"
      );
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
