import { CdkCustomResourceEvent, CdkCustomResourceResponse } from "aws-lambda";
import { ICustomResourceTGWStaticRoute } from "../../lib/types";
import {
  EC2Client,
  DeleteTransitGatewayRouteCommand,
  CreateTransitGatewayRouteCommand,
  ReplaceTransitGatewayRouteCommand,
} from "@aws-sdk/client-ec2";

const client = new EC2Client({ region: process.env.AWS_REGION });

const createTransitGatewayStaticRoute = async (
  requestProps: ICustomResourceTGWStaticRoute,
) => {
  await client.send(
    new CreateTransitGatewayRouteCommand({
      DestinationCidrBlock: requestProps.destinationCidrBlock,
      TransitGatewayAttachmentId: requestProps.transitGatewayAttachmentId,
      TransitGatewayRouteTableId: requestProps.transitGatewayRouteTableId,
    }),
  );
};

const replaceTransitGatewayRoute = async (
  requestProps: ICustomResourceTGWStaticRoute,
) => {
  await client.send(
    new ReplaceTransitGatewayRouteCommand({
      DestinationCidrBlock: requestProps.destinationCidrBlock,
      TransitGatewayAttachmentId: requestProps.transitGatewayAttachmentId,
      TransitGatewayRouteTableId: requestProps.transitGatewayRouteTableId,
    }),
  );
};

const deleteTransitGatewayStaticRoute = async (
  requestProps: ICustomResourceTGWStaticRoute,
) => {
  await client.send(
    new DeleteTransitGatewayRouteCommand({
      DestinationCidrBlock: requestProps.destinationCidrBlock,
      TransitGatewayRouteTableId: requestProps.transitGatewayRouteTableId,
    }),
  );
};

export const onEvent = async (event: CdkCustomResourceEvent) => {
  console.info(event);
  const requestProps: ICustomResourceTGWStaticRoute =
    event.ResourceProperties as any;

  const responseProps: CdkCustomResourceResponse = {
    PhysicalResourceId: `${requestProps.transitGatewayRouteTableId}:${requestProps.destinationCidrBlock}`,
  };

  if (event.RequestType == "Create") {
    await createTransitGatewayStaticRoute(requestProps);
    console.info("Created Route");
    return { responseProps };
  } else if (event.RequestType == "Update") {
    await replaceTransitGatewayRoute(requestProps);
    console.info("Updated Route");
    return { responseProps };
  } else if (event.RequestType == "Delete") {
    await deleteTransitGatewayStaticRoute(requestProps);
    console.info("Deleted Route");
    return { responseProps };
  } else {
    console.log("Called without Create, Update, Or Delete");
    return { responseProps };
  }
};
