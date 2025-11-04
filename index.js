// In: index.js
import { runAgentCore } from './src/core/AgentCore.js';

console.log("--- PROZESS START ---");

const userInput = {
  text: "Foto von Haus mit Notiz 'Schaden am Dach'",
  fotos: []
};

const finalReport = runAgentCore(userInput);

console.log("--- PROZESS ENDE ---");
console.log("\n--- Output an Mensch (5) ---");
console.log(finalReport);