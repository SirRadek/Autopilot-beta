import { initializeProjectRegistry } from "../src/data/delivery-system/projectRegistry";

const USAGE = "usage: npm run projects:init -- STATE_DIR [PROJECT_ROOT]";

function main(args: readonly string[]): void {
  const [stateDir, projectRoot, extra] = args;
  if (stateDir === undefined || extra !== undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  try {
    const result = initializeProjectRegistry(
      stateDir,
      projectRoot === undefined ? {} : { projectRoot }
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "project_registry_io_error");
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
