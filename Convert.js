// Convert HYG CSV to JSON - save as convert.js and run with Node.js
const fs = require("fs");
const csv = require("csv-parser");

const results = [];

fs.createReadStream("hygdata_v3.csv")
  .pipe(csv())
  .on("data", (data) => {
    // Convert string values to numbers where needed
    const star = {
      id: parseInt(data.id),
      proper: data.proper || null,
      name: data.name || data.bayer || null,
      ra: parseFloat(data.ra),
      dec: parseFloat(data.dec),
      mag: parseFloat(data.mag),
      ci: data.ci ? parseFloat(data.ci) : null, // Color index
      spect: data.spect || null,
    };
    results.push(star);
  })
  .on("end", () => {
    fs.writeFileSync("hygdata_v3.json", JSON.stringify(results));
    console.log(`Converted ${results.length} stars to JSON`);
  });
