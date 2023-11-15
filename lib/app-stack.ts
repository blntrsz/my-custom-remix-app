import "source-map-support/register";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { HttpLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { HttpApi, PayloadFormatVersion } from "@aws-cdk/aws-apigatewayv2-alpha";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { HttpOrigin, S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  AddBehaviorOptions,
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { ParameterTier, StringParameter } from "aws-cdk-lib/aws-ssm";

export class AppStack extends Stack {
  readonly distributionUrlParameterName = "/remix/distribution/url";

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, "StaticAssetsBucket");

    new BucketDeployment(this, "DeployStaticAssets", {
      sources: [Source.asset("./public")],
      destinationBucket: bucket,
      destinationKeyPrefix: "_static",
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
        originRequestPolicyName: "website-request-handler",
        queryStringBehavior: OriginRequestQueryStringBehavior.all(),
        cookieBehavior: OriginRequestCookieBehavior.all(),
        // https://stackoverflow.com/questions/65243953/pass-query-params-from-cloudfront-to-api-gateway
        headerBehavior: OriginRequestHeaderBehavior.none(),
      }
    );
    const requestHandlerBehavior: AddBehaviorOptions = {
      allowedMethods: AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy,
    };

    const assetOrigin = new S3Origin(bucket);
    const assetBehaviorOptions = {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const distribution = new Distribution(this, "CloudFront", {
      defaultBehavior: {
        origin: requestHandlerOrigin,
        ...requestHandlerBehavior,
      },
      priceClass: PriceClass.PRICE_CLASS_100,
    });

    distribution.addBehavior("/_static/*", assetOrigin, assetBehaviorOptions);

    new StringParameter(this, "DistributionUrlParameter", {
      parameterName: this.distributionUrlParameterName,
      stringValue: distribution.distributionDomainName,
      tier: ParameterTier.STANDARD,
    });
  }
}
