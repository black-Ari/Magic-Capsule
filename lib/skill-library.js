'use strict';

// Ready-made skills, added with one click in Settings > AI. A skill is plain instructions: it guides
// the AI and never gives it new powers, and the Agent's safety rules always come first.
// Keywords decide when an Auto skill applies; they cover English, Hinglish and Hindi.
const SKILL_LIBRARY = [
  {
    name: 'GST filing',
    description: 'Prepares GST returns with you, never files or pays',
    keywords: ['gstr', 'gstr1', 'gstr3b', 'gstr2b', 'itc', 'gst return', 'gst filing', 'gst file', 'gst bharna', 'gst bharo', 'gst portal', 'जीएसटी रिटर्न'],
    text: 'For GST returns, help me prepare on gst.gov.in. Match my sales invoices against GSTR-1, and claim input tax credit only as shown in GSTR-2B. Check due dates, rates and rules on the official portal, never from memory. Show me a table of tax payable and ITC before anything. I sign in, type OTPs, pay and submit myself. Never submit, file or pay. Never invent a figure; ask me. For notices or anything unclear, tell me to ask my CA.',
  },
  {
    name: 'ITR filing',
    description: 'Prepares income tax returns with you, never submits them',
    keywords: ['itr', 'itr1', 'itr2', 'itr3', 'itr4', 'tds', '26as', 'ais', 'income tax', 'form 16', 'tax return', 'itr bharna', 'itr file', 'itr filing', 'आयकर', 'आईटीआर'],
    text: 'For income tax returns, help me prepare on incometax.gov.in. Compare my Form 16, AIS and Form 26AS and point out every mismatch. Check the right ITR form, old or new regime, and due dates on the official site, never from memory. Show the income, deductions and tax as a table. I sign in, type OTPs, pay, submit and e-verify myself. Never invent a figure or deduction. For business income, capital gains or notices, tell me to ask my CA.',
  },
  {
    name: 'Excel and Word',
    description: 'Works in Office files directly, without clicking around',
    keywords: ['excel', 'xlsx', 'xls', 'spreadsheet', 'sheet', 'word', 'docx', 'doc', 'powerpoint', 'pptx', 'एक्सेल', 'शीट'],
    text: 'For Excel, Word and PowerPoint files, write a VBScript that uses CreateObject and run it with cscript through run_command. Save the script with Set-Content -Encoding Unicode so Hindi text stays correct. Always call Quit at the end, so no hidden Office copy stays running. Save a new file unless I asked you to change the existing one, and tell me which file you changed.',
  },
  {
    name: 'Hinglish replies',
    description: 'Answers in simple Hinglish',
    mode: 'always',
    keywords: [],
    text: 'Reply in simple Hinglish (Hindi written in English letters, mixed with common English words), unless I write in another language or ask for something else. Use short sentences and everyday words. Explain any technical word in one line. Keep code, file names, commands and button names in English exactly as they appear.',
  },
  {
    name: 'PC speed check',
    description: 'Finds what is slowing your PC, changes nothing without asking',
    keywords: ['slow', 'hang', 'hanging', 'lag', 'lagging', 'ram', 'memory', 'cpu', 'speed', 'startup', 'temp files', 'pc clean', 'clean pc', 'dheema', 'dhima', 'atak', 'atakta', 'धीमा', 'हैंग'],
    text: 'When I ask why my PC is slow or what to clean: first find out what is really using memory, processor and disk, and show the biggest items in a short list. Suggest the safest fix first, such as closing an app or turning off a startup item. Do not uninstall, delete or change a Windows setting until I say yes to that exact item.',
  },
  {
    name: 'File organiser',
    description: 'Shows a plan first, never deletes',
    keywords: ['organise', 'organize', 'sort', 'arrange', 'folder', 'folders', 'downloads', 'tidy', 'duplicate', 'duplicates', 'files set', 'फोल्डर', 'फाइल'],
    text: 'When I ask you to sort or clean a folder: first look at what is in it and show me a plan of which files go to which folder. Wait for my yes before moving anything. Group by type or project, keep the original file names, never overwrite and never delete. At the end, tell me what moved where.',
  },
  {
    name: 'Business documents',
    description: 'Invoices and quotations in Indian GST format',
    keywords: ['invoice', 'invoices', 'bill', 'billing', 'gst', 'gstin', 'quotation', 'quote', 'estimate', 'receipt', 'letterhead', 'challan', 'बिल', 'इनवॉइस', 'जीएसटी', 'कोटेशन'],
    text: 'For invoices, quotations, receipts and business letters, use Indian format: amounts in ₹ with Indian digit grouping such as 1,00,000, dates as DD/MM/YYYY, and GST shown separately as CGST and SGST, or as IGST for another state. Never invent a GSTIN, price, tax rate or address. If a detail is missing, ask me. Show the calculation so I can check the total.',
  },
  {
    name: 'Message writer',
    description: 'WhatsApp and email drafts, never sends them',
    keywords: ['whatsapp', 'email', 'mail', 'message', 'msg', 'reply', 'customer', 'client', 'draft', 'jawab', 'sandesh', 'मैसेज', 'ईमेल', 'जवाब'],
    text: 'When I ask for a WhatsApp message, email or customer reply: write it ready to copy, polite and short, in the language I use. Give one main version, and a shorter one if it is long. Do not send anything yourself. Put [brackets] around any detail you do not know instead of making it up.',
  },
  {
    name: 'Web research',
    description: 'Checks sources and gives links',
    keywords: ['research', 'compare', 'comparison', 'review', 'reviews', 'latest', 'price', 'best', 'kaunsa', 'konsa', 'dhoondh', 'dhundo', 'पता', 'तुलना'],
    text: 'When I ask you to find or compare something online: check at least two good sources, prefer official sites, and note how recent the information is. Give the answer first, then the links. Say clearly when sources disagree or you are not sure. Do not log in, sign up, download or buy anything while researching.',
  },
  {
    name: 'Coding helper',
    description: 'Small, explained changes to your projects',
    keywords: ['code', 'coding', 'bug', 'error', 'electron', 'node', 'nodejs', 'python', 'android', 'javascript', 'typescript', 'html', 'css', 'function', 'api', 'script', 'app', 'website', 'कोड'],
    text: 'For my software projects (Node.js, Electron, Android, Python, websites): read the existing code before changing it and match its style. Make the smallest change that solves the problem, explain it in plain words, and tell me how to test it. Before changing several files, tell me the plan. Never delete files or publish anything without asking me.',
  },
  {
    name: 'Daily planner',
    description: 'Turns your list into a realistic day',
    keywords: ['plan', 'schedule', 'routine', 'timetable', 'todo', 'to do', 'priorities', 'aaj ka', 'din ka', 'दिन', 'योजना'],
    text: 'When I give you my tasks: put the most important and time-bound ones first, and make a realistic plan with time blocks and short breaks. Keep it to what can really be done today and list the rest for later. Ask me one question if a deadline is unclear.',
  },
  {
    name: 'Scam check',
    description: 'Warns you before risky links and payments',
    keywords: ['scam', 'fake', 'fraud', 'phishing', 'otp', 'kyc', 'lottery', 'safe', 'suspicious', 'asli', 'nakli', 'dhokha', 'धोखा', 'नकली', 'फ्रॉड'],
    text: 'Before I download something, open a strange link or pay online, check it: the real website address, signs of a fake page, pressure tactics, and offers that sound too good. Answer Safe, Careful or Avoid, with the reason in one line. If you are not sure, say Careful.',
  },
];

module.exports = { SKILL_LIBRARY };
