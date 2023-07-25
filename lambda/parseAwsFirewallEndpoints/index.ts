import { CdkCustomResourceEvent, CdkCustomResourceResponse } from "aws-lambda";
import { ICustomResourceParseAwsFirewallEndpoints } from "../../lib/types";

export const onEvent = async (event: CdkCustomResourceEvent) => {
  console.info(event);
  const responseProps: CdkCustomResourceResponse = {};
  if (
    event.RequestType == "Create" ||
    event.RequestType == "Update" ||
    event.RequestType == "Delete"
  ) {
    const requestProps: ICustomResourceParseAwsFirewallEndpoints =
      event.ResourceProperties as any;
    requestProps.firewallEndpoints.forEach((endpoint) => {
      const endpointDetails = endpoint.split(":");
      if (endpointDetails[0] == requestProps.availabilityZone) {
        responseProps.PhysicalResourceId = endpointDetails[1];
        responseProps.Data = {
          endpointId: endpointDetails[1],
        };
      }
    });
    // Our CDK framework will trap this and send a failure back to the Template as desired.
    if (!responseProps.hasOwnProperty("PhysicalResourceId")) {
      throw new Error(
        `Unable to find ${requestProps.availabilityZone} in endpoint details ${requestProps.firewallEndpoints}`,
      );
    }
  }
  console.info(responseProps);
  return responseProps;
};
