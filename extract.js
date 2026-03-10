const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// We don't have unzip, python or python3. Let's try to see if we can use node's zlib or any other module.
// Wait, we can install a package like 'unzipper' or 'adm-zip' locally just to extract.
