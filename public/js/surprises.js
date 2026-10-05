// "Surprise me" prompts. Spread across the board so every line gets calls.
export const SURPRISES = [
  "Book me a table for 4 at a good ramen spot this Friday at 7",
  "Negotiate my internet bill down, I've been a customer for 5 years",
  "Order a pack of 10k resistors and a breadboard, cheapest shipping",
  "Schedule a dentist cleaning for next Tuesday morning",
  "Write a Python script that renames my photos by the date they were taken",
  "Help me write a cover letter for a hardware engineering internship",
  "Debug this: my Arduino servo jitters every time the motor starts",
  "Explain Thevenin equivalents like I'm cramming for an exam in 2 hours",
  "Prove that the square root of 2 is irrational",
  "Solve the integral of x^2 e^x dx step by step",
  "Find the eigenvalues of [[2, 1], [1, 2]] and explain what they mean",
  "What's everyone on X saying about the new iPhone?",
  "Roast my music taste: 80% Drake, 20% lo-fi study beats",
  "Latest news on solid-state batteries, with sources",
  "Compare the top 3 budget oscilloscopes under $500",
  "Is it true that we lose most of our body heat through our heads?",
  "Make an Excel formula that flags duplicate emails in column B",
  "Turn my Word outline into a 10-slide PowerPoint",
  "Summarize this YouTube lecture on Fourier transforms",
  "Plan a 3-day Austin road trip with stops on Google Maps",
  "Find the email from my professor about the lab report deadline in my Gmail",
  "Generate an image of a cat running a 1950s telephone switchboard",
  "Give me 10 name ideas for a college robotics club",
  "What's a quick high-protein dinner I can make in a dorm microwave?",
];

export function randomSurprise(previous) {
  let next;
  do {
    next = SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
  } while (next === previous && SURPRISES.length > 1);
  return next;
}
