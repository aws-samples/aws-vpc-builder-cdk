import {
  EC2Client,
  DescribeVpcEndpointServicesCommand,
  DescribeAvailabilityZonesCommand,
  ServiceDetail,
} from "@aws-sdk/client-ec2";
import * as path from "path";
import * as fs from "fs";

const filterAvailabilityZone = (
  requiredAz: Array<string>,
  serviceDetail: ServiceDetail
) => {
  if (serviceDetail.AvailabilityZones) {
    return requiredAz.every((i) =>
      serviceDetail.AvailabilityZones?.includes(i)
    );
  }
  return false;
};

(async () => {
  const requiredAzs = process.argv.slice(2);

  // Assure we got at least one argument
  if (requiredAzs.length < 1) {
    console.error(
      `ERROR: Provide availability zones to filter for ie: '${process.argv[0]} us-east-1a us-east-1-b us-east-1c'`
    );
    process.exit(1);
  }

  // Remove our last character and we should get a region to connect to
  const region = requiredAzs[0].slice(0, -1);

  const client = new EC2Client({ region: region });

  // Verify the availability zones we got on the commandline exist.
  try {
    await client.send(
      new DescribeAvailabilityZonesCommand({
        ZoneNames: requiredAzs,
      })
    );
  } catch (e) {
    console.error(
      `ERROR: AZ Names '${requiredAzs}' provided on commandline do not exist:\n ${e}`
    );
    console.error(
      `ERROR: Provide availability zones to filter for ie: '${process.argv[0]} us-east-1a us-east-1-b us-east-1c'`
    );
    process.exit(1);
  }

  console.log(
    `Discovering all common endpoints for availability zones ${requiredAzs.join(
      ", "
    )}`
  );
  // Describe our endpoints (this gets them all in the region)
  const command = new DescribeVpcEndpointServicesCommand({
    Filters: [
      {
        Name: "service-type",
        Values: ["Interface"],
      },
    ],
  });
  const response = await client.send(command);

  // Filter our results based on the availability zones on our commandline
  let filtered: Array<ServiceDetail> = [];
  if (response.ServiceDetails) {
    filtered = response.ServiceDetails.filter((serviceDetail) =>
      filterAvailabilityZone(requiredAzs, serviceDetail)
    );
  }

  // Create a file in the discovery directory which will be used for config file validation during execution.
  fs.writeFileSync(
    path.join("discovery", `endpoints-${region}.json`),
    JSON.stringify(filtered, null, 2),
    { encoding: "utf8" }
  );

  // Build a simple text file in our config directory containing all endpoints available with the filter that our
  // Users can modify to suit.
  const endpointList = filtered.map(
    (serviceDetail) => serviceDetail.ServiceName
  );

  fs.writeFileSync(
    path.join("config", `all-endpointslist-${region}.txt`),
    endpointList.join("\n"),
    { encoding: "utf8" }
  );

  console.info(
    `Discovery results written to 'all-endpointslist-${region}.txt'.  Modify according to your needs.`
  );
})();
