import {
  EC2Client,
  DescribeVpcEndpointServicesCommand,
} from "@aws-sdk/client-ec2";
import * as path from "path";
import * as fs from "fs";
import * as ri from "@aws-cdk/region-info";

(async () => {
  for (const regionInfo of ri.RegionInfo.regions) {
    if (!regionInfo.isOptInRegion && regionInfo.partition == "aws") {
      const region = regionInfo.name;
      console.log(`Connecting to Region ${region}`);
      const client = new EC2Client({ region: region });

      console.log(`. . . Describing all interface endpoints`);
      const command = new DescribeVpcEndpointServicesCommand({
        Filters: [
          {
            Name: "service-type",
            Values: ["Interface"],
          },
        ],
      });
      const response = await client.send(command);
      if (response.ServiceDetails) {
        console.log(
          `. . . Saving all discovered endpoints to file discovery/endpoints-${region}.json`,
        );
        fs.writeFileSync(
          path.join("discovery", `endpoints-${region}.json`),
          JSON.stringify(response.ServiceDetails, null, 2),
          { encoding: "utf8" },
        );
      } else {
        console.error(
          `ERROR: Empty or missing response for ServiceDetails when working with region ${region}`,
        );
        process.exit(1);
      }
    }
  }
})();
