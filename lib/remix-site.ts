import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { HttpLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { HttpApi, PayloadFormatVersion } from "@aws-cdk/aws-apigatewayv2-alpha";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CfnOutput, DockerImage, Duration, Stack } from "aws-cdk-lib";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { HttpOrigin, S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AddBehaviorOptions,
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { ParameterTier, StringParameter } from "aws-cdk-lib/aws-ssm";
import { execSync } from "child_process";
import { cpSync } from "fs";
import { join } from "path";
import { CanaryDeployment } from "./canary-deploy";

export class RemixSite extends Construct {
  readonly distributionUrlParameterName = "/remix/distribution/url";

  constructor(
    scope: Construct,
    id: string,
    props: { path: string; buildCommand: string }
  ) {
    super(scope, id);

    const bundle = Source.asset(props.path, {
      bundling: {
        image: DockerImage.fromRegistry("alpine"),
        local: {
          tryBundle(outputDir: string) {
            try {
              execSync(props.buildCommand, {
                cwd: props.path,
                stdio: "inherit",
                env: process.env,
              });
              cpSync(join(props.path, "/public"), outputDir, {
                recursive: true,
              });
              return true;
            } catch (e) {
              console.error(e);
              return false;
            }
          },
        },
      },
    });

    const fn = new NodejsFunction(this, "RequestHandler", {
      runtime: Runtime.NODEJS_18_X,
      handler: "handler",
      entry: "./server/index.ts",
      environment: {
        NODE_ENV: "production",
      },
      bundling: {
        nodeModules: ["@remix-run/architect", "react", "react-dom"],
      },
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.THREE_DAYS,
      tracing: Tracing.ACTIVE,
    });
    const integration = new HttpLambdaIntegration(
      "RequestHandlerIntegration",
      fn,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );
    const httpApi = new HttpApi(this, "WebsiteApi", {
      defaultIntegration: integration,
    });

    const httpApiUrl = `${httpApi.httpApiId}.execute-api.${
      Stack.of(this).region
    }.${Stack.of(this).urlSuffix}`;
    const requestHandlerOrigin = new HttpOrigin(httpApiUrl);
    const originRequestPolicy = new OriginRequestPolicy(
      this,
      "RequestHandlerPolicy",
      {
        originRequestPolicyName: "request-handler-policy",
        queryStringBehavior: OriginRequestQueryStringBehavior.all(),
        cookieBehavior: OriginRequestCookieBehavior.all(),
        headerBehavior: OriginRequestHeaderBehavior.none(),
      }
    );

    const serverCachePolicy = new CachePolicy(this, "ServerCache", {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.none(),
      cookieBehavior: CacheCookieBehavior.all(),
      defaultTtl: Duration.days(0),
      maxTtl: Duration.days(365),
      minTtl: Duration.days(0),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const requestHandlerBehavior: AddBehaviorOptions = {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: serverCachePolicy,
      originRequestPolicy,
    };
    const distribution = new Distribution(this, "CloudFront", {
      defaultBehavior: {
        origin: requestHandlerOrigin,
        ...requestHandlerBehavior,
      },
      priceClass: PriceClass.PRICE_CLASS_100,
    });

    const bucket = new Bucket(this, "StaticAssetsBucket");

    new BucketDeployment(this, "DeployStaticAssets", {
      sources: [bundle],
      destinationBucket: bucket,
      destinationKeyPrefix: "_static",
      distribution,
      distributionPaths: ["/*"],
    });

    new CanaryDeployment(this, "canary", { lambda: fn });

    const assetOrigin = new S3Origin(bucket);
    const assetBehaviorOptions = {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    distribution.addBehavior("/_static/*", assetOrigin, assetBehaviorOptions);

    new StringParameter(this, "DistributionUrlParameter", {
      parameterName: this.distributionUrlParameterName,
      stringValue: distribution.distributionDomainName,
      tier: ParameterTier.STANDARD,
    });

    new CfnOutput(this, "endpoint", {
      value: distribution.distributionDomainName,
    });
  }
}
