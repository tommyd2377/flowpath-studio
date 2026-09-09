const requiredMajor = 24;

if (Number(process.versions.node.split('.')[0]) !== requiredMajor) {
  console.error(`TheVoice requires Node.js ${requiredMajor}. Current version: ${process.version}.`);
  console.error('Run `nvm use` from the project directory, then retry this command.');
  process.exit(1);
}
