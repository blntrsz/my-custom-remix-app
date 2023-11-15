import { Duration } from "aws-cdk-lib";
import { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  LambdaApplication,
  LambdaDeploymentGroup,
  LambdaDeploymentConfig,
} from "aws-cdk-lib/aws-codedeploy";
import { Alias, Function } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export class CanaryDeployment extends Construct {
  constructor(scope: Construct, id: string, props: { lambda: Function }) {
    super(scope, id);

    const alias = new Alias(this, "alias", {
      aliasName: "dev",
      version: props.lambda.currentVersion,
    });

    const alarm = new Alarm(this, "alarm", {
      alarmDescription: "The latest deployment errors > 0", // give the alarm a name
      metric: alias.metricErrors({
        period: Duration.minutes(1),

        dimensionsMap: {
          FunctionName: props.lambda.functionName,
          Resource: `${props.lambda.functionName}:${alias.aliasName}`,
          ExecutedVersion: props.lambda.currentVersion.version,
        },
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    const application = new LambdaApplication(this, "lambda-application");

    new LambdaDeploymentGroup(this, "canary-deployment", {
      application,
      alias: alias,
      deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
      alarms: [alarm],
    });
  }
}
