import {
  BarChart,
  Callout,
  Code,
  Grid,
  H1,
  H2,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

export default function P1BenchmarkScores() {
  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>P1 benchmark scores</H1>
        <Text tone="secondary">
          SoT path <Code>snapshots/p1-roadmap-20261030/SUMMARY.md</Code>
          {" · "}
          Partial / N=1 ≠ board %
        </Text>
      </Stack>

      <Grid columns={3} gap={16}>
        <Stat value="27/27 · 100.0%" label="B-04 unique High" />
        <Stat value="6/27 · 22.2%" label="B-05 OpenCode match" />
        <Stat value="70/300 · 23.3%" label="Lite mini-SWE" />
      </Grid>

      <Stack gap={12}>
        <H2>Percent of each denominator</H2>
        <BarChart
          horizontal
          categories={["B-04 unique High", "B-05 OpenCode match", "Lite mini-SWE"]}
          series={[
            {
              name: "% of denominator",
              data: [100.0, 22.2, 23.3],
              tone: "info",
            },
          ]}
          yMax={100}
          beginAtZero
          height={280}
          valueSuffix="%"
        />
      </Stack>

      <Stack gap={12}>
        <H2>Score detail</H2>
        <Table
          headers={["Row", "Score", "Percent", "What it measures"]}
          columnAlign={["left", "right", "right", "left"]}
          rows={[
            [
              "B-04 unique High",
              "27/27",
              "100.0%",
              "Unique High slice closed at 27/27; post-slice resolves noted separately",
            ],
            [
              "B-05 OpenCode match",
              "6/27",
              "22.2%",
              "Same-model OpenCode parity cells",
            ],
            [
              "Lite mini-SWE",
              "70/300",
              "23.3%",
              "Mini SWE-bench Lite scored resolves (completed denom)",
            ],
          ]}
        />
      </Stack>

      <Callout tone="info" title="Interpretation">
        B-04 unique denominator closed at 27/27 (Partial evidence complete). B-05 and Lite still open. Not official SWE Lite leaderboard %. Terminal Bench deferred.
      </Callout>
    </Stack>
  );
}
