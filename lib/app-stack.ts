import "source-map-support/register";
import { Construct } from "constructs";
import { Stack, StackProps } from "aws-cdk-lib";
import { RemixSite } from "./remix-site";

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new RemixSite(this, "site", {
      buildCommand: "pnpm run build",
      path: "./",
    });
  }
}
