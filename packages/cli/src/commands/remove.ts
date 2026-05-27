import chalk from "chalk";
import { removeServer } from "../hub.js";

export function remove(name: string) {
  const ok = removeServer(name);
  if (ok) {
    console.log(chalk.green(`✓ Removed "${name}" from master`));
  } else {
    console.error(chalk.yellow(`"${name}" not found in master`));
  }
}
