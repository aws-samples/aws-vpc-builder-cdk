import { CdkCustomResourceEvent, CdkCustomResourceResponse } from "aws-lambda";
import { ICustomResourceTGWFindVpnAttach } from "../../lib/types";
import {
  EC2Client,
  DescribeTransitGatewayAttachmentsCommand,
} from "@aws-sdk/client-ec2";

const client = new EC2Client({ region: process.env.AWS_REGION });

const findVpnTransitGatewayAttachId = async (
  requestProps: ICustomResourceTGWFindVpnAttach,
) => {
  const vpnResponse = await client.send(
    new DescribeTransitGatewayAttachmentsCommand({
      Filters: [
        {
          Name: "transit-gateway-id",
          Values: [requestProps.transitGatewayId],
        },
        {
          Name: "resource-type",
          Values: ["vpn"],
        },
        {
          Name: "resource-id",
          Values: [requestProps.vpnId],
        },
      ],
    }),
  );
  if (vpnResponse.TransitGatewayAttachments) {
    return vpnResponse.TransitGatewayAttachments[0]
      .TransitGatewayAttachmentId as string;
  } else {
    throw new Error(
      `Failed to retrieve any transit gateway attachments for vpn ${requestProps.vpnId} TGW ${requestProps.transitGatewayId}`,
    );
  }
};

export const onEvent = async (event: CdkCustomResourceEvent) => {
  console.info(event);
  const requestProps: ICustomResourceTGWFindVpnAttach =
    event.ResourceProperties as any;

  const responseProps: CdkCustomResourceResponse = {
    PhysicalResourceId: `${requestProps.transitGatewayId}:${requestProps.vpnId}`,
  };

  if (event.RequestType == "Create" || event.RequestType == "Update") {
    const transitGatewayAttachId = await findVpnTransitGatewayAttachId(
      requestProps,
    );
    console.info(`Retrieved identifier: ${transitGatewayAttachId}`);
    responseProps.Data = {
      transitGatewayAttachId: transitGatewayAttachId,
    };
    return responseProps;
  } else if (event.RequestType == "Delete") {
    console.info("Delete.  No action taken");
    return responseProps;
  } else {
    console.log("Called without Create, Update, Or Delete");
    return responseProps;
  }
};
