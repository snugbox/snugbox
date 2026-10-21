import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);

const tailscaleAddress = addresses.find((address) => {
    const [first, second] = address.split(".").map(Number);
    return first === 100 && second >= 64 && second <= 127;
});

const hostname = tailscaleAddress ?? addresses[0];

if (!hostname) {
    console.error("No network IPv4 address found. Use `pnpm dev` for local access.");
    process.exit(1);
}

console.log(`Using network address ${hostname}`);

const child = spawn("next", ["dev", "--hostname", hostname, ...process.argv.slice(2)], {
    stdio: "inherit",
});

child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
});

child.on("exit", (code) => {
    process.exitCode = code ?? 1;
});
