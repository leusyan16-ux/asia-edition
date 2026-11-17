import { commerceStagingErrors } from "../src/features/commerce/config";
const errors = commerceStagingErrors(process.env);
if (errors.length) {
  console.error(
    "Staging NOT ready. Check variable names only:",
    [...new Set(errors)].join(", "),
  );
  process.exitCode = 1;
} else
  console.log(
    "Staging configuration is isolated. No network request, migration or database write performed.",
  );
