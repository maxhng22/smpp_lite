const readline = require('readline');
const fs = require('fs');
const yaml = require('js-yaml');
const smpp = require('smpp');
const pino = require('pino');

const fileTransport = pino.transport({
    targets: [
        {
            target: 'pino/file',
            options: { destination: `${__dirname}/smpp.log` }
        },
      {
            target: 'pino-pretty'
        }  
    ]
});

const logger = pino(fileTransport);

// Create an interface for reading input from the command line
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const config = yaml.load(fs.readFileSync('./config.yaml', 'utf8'));

// let files
let host, port, systemId, password, systemType;
let soleRun, soleSource, soleDestination, soleMessage;
let loadRun, loadSource, loadDestination, loadMessage, loadtotalMessage, loadtps;

// Get config values and set them
try {
    // files = config.file.filename;
    host = config.smpp.host;
    port = config.smpp.port;
    systemId = config.smpp.systemId;
    systemType = config.smpp.systemType;
    password = config.smpp.password;

    soleRun = config.message.run;
    soleSource = config.message.source;
    soleDestination = config.message.destination;
    soleMessage = config.message.message;

    loadRun = config.loadTest.run;
    loadSource = config.loadTest.source;
    loadDestination = config.loadTest.destination;
    loadMessage = config.loadTest.message;
    loadtotalMessage = config.loadTest.totalMessage;
    loadtps = config.loadTest.tps;
} catch (e) {
    logger.error(`Parameter is missing: ${e}`);
    process.exit(1); // Exit if config loading fails
}

// Function to display the loading bar
function loadingBar(total, current) {
    const length = 30; // Length of the loading bar
    const progress = Math.floor((current / total) * length);
    const bar = '█'.repeat(progress) + '-'.repeat(length - progress);
    const percentage = ((current / total) * 100).toFixed(2);
    const timestamp = getTimestamp(); 

    const green = '\x1b[32m';
    const reset = '\x1b[0m';
    const lightBlue = '\x1b[38;2;86;173;188m';
    // const reset = '\x1b[0m';
    // Clear the current line and print the loading bar
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${timestamp} ${green}INFO${reset} (${process.pid}): ${lightBlue}Progress: [${bar}] ${percentage}%${reset}`);
    // console.log(percentage)
    if(((current / total) * 100)===100)
    console.log('');
    
    
}

// Prompt the user for their file name
rl.question('Please enter the output file name: ', (files) => {
    const file = `${files}.txt`
     
    fs.writeFileSync(file, `SMPP Client Log - ${new Date().toISOString()}\n\n`);
    fs.appendFileSync(file, `**Settings**\n`);
    fs.appendFileSync(file, `SMPP Server: ${host}:${port}\n`);
    fs.appendFileSync(file, `System ID: ${systemId}\n`);
    fs.appendFileSync(file, `System Type: ${host}:${port}\n`);
    fs.appendFileSync(file, `Total Messages to Send: ${loadtotalMessage}\n`);
    fs.appendFileSync(file, `Transactions Per Second (TPS): ${loadtps}\n\n`);


    logger.info(`SMPP Server: ${host}:${port}`);
    logger.info(`SMPP Port: ${port}`);
    logger.info(`SMPP System ID: ${systemId}`);
    logger.info(`SMPP System Type: ${systemType}`);

    const smppClient = new smpp.Session({ host: host, port: port });

    logger.info(`Attempting to connect to SMPP server at ${host}:${port}. Timestamp: ${new Date().toISOString()}`);

    fs.appendFileSync(file, `**Connection Status**\n`);
    smppClient.on('connect', () => {
        logger.info('Successfully connected to SMPP server');
        fs.appendFileSync(file, `Connection Established: Success\n`);

        const bindParams = {
            system_id: systemId,
            password: password || '',
            system_type: systemType || '',
            interface_version: 0x34 // Proper hex value without quotes
        };

        logger.info(`Attempting to bind to SMPP server at ${host}:${port}. Timestamp: ${new Date().toISOString()}`);
        smppClient.bind_transceiver(bindParams, (pdu) => {
            if (pdu.command_status === 0) {
                logger.info('Successfully bound to the SMPP server');
                fs.appendFileSync(file, `Bind Status: Successfully bound to the SMPP server\n\n`);

                let encoding;
                let shortMessages;

                // Determine encoding based on message content
                if (isChinese(soleMessage)) {
                    encoding = 8; // UCS2 encoding for Chinese characters
                } else {
                    encoding = 0; // Default GSM 7-bit encoding for English
                }

                let totalFailed=0;
                let returnedSm=0;
                let successfulSubmissions = 0;

                function startSendingMessages() {
                    let messagesSent = 0;
                    let startTime = null;
                    let startTimeDateFormat=null
                    let delayTime = 0;
                    const intervalId = setInterval(() => {

                        if (!startTime) { // Check if start time is not set yet
                            startTime = performance.now();
                            startTimeDateFormat = new Date();
                        }

                        if (messagesSent >= loadtotalMessage) {
                            
                            if (returnedSm >= loadtotalMessage || delayTime >= 5) {
    
                                clearInterval(intervalId);
                                smppClient.unbind();
                                const endTime = performance.now();
                                const endTimeDateFormat = new Date();
                                const totalTime = endTime - startTime


                                fs.appendFileSync(file, `Load Test Start Time: ${startTimeDateFormat.toISOString()}(${startTime})\n`);
                                fs.appendFileSync(file, `Load Test End Time: ${endTimeDateFormat.toISOString()}(${endTime})\n`);
                                fs.appendFileSync(file, `Total Time Spent: ${totalTime}\n`);
                                fs.appendFileSync(file, `Total Messages Sent: ${messagesSent}\n`);
                                fs.appendFileSync(file, `Total Responses Received: ${returnedSm}\n`);
                                fs.appendFileSync(file, `Successful Deliveries: ${successfulSubmissions}\n`);
                                fs.appendFileSync(file, `Failed Deliveries: ${totalFailed}\n\n`);

                                logger.info(`Load test completed`);
                                logger.info(`**Load Test Summary**`);
                                logger.info(`Total Time Spent: ${totalTime} ms`);
                                logger.info(`Total Messages Sent: ${messagesSent}`);
                                logger.info(`Total Responses Received: ${returnedSm}`);
                                logger.info(`Successful Deliveries: ${successfulSubmissions}`);
                                logger.info(`Failed Deliveries: ${totalFailed}`);
                               
                                return;
                            } else {
                                
                                delayTime++
                                logger.info(`Waiting for SMPP server response... Timeout in ${5 - delayTime} seconds.`);
                            }

                        }else{
                            if (messagesSent <= loadtotalMessage) {
                                let startTime2 = performance.now();
    
                                let numberOfmessage = parseInt(loadtps, 10)
                                let exceeded = messagesSent + parseInt(loadtps, 10)
                                if (exceeded > loadtotalMessage) {
                                    numberOfmessage = loadtotalMessage - messagesSent
                                    messagesSent += loadtotalMessage - messagesSent
                                } else {
                                    messagesSent += parseInt(loadtps, 10)
                                }
    
                                // Display loading bar
                                loadingBar(loadtotalMessage, messagesSent);
    
                                const promises = [];
                                for (let i = 1; i <= numberOfmessage; i++) {
                                    promises.push(createSubmitSmPromise(i, loadDestination, loadSource, loadMessage, smppClient).then(() => {
                                        successfulSubmissions++
                                        returnedSm++
                                    }).catch((error) => {
                                            returnedSm++
                                            totalFailed++
                                            // console.error(error);
                                        }));
                                }
    
                                // Send all messages concurrently
                                Promise.all(promises)
                                    .then(() => {
                                        const endTime = performance.now();
                                        const latency = endTime - startTime2;
                                        totalLatency += latency;
                                        latencyArray.push(latency);
                                   
                                    })
                                    .catch((error) => {
                                        // Handle error
                                    });
    
                            }
                        }

                      
                    }, 1000);
                }

                fs.appendFileSync(file, `**Message Sending Status**\n`);
                logger.info(`Attempting to send message to SMPP server. Timestamp: ${new Date().toISOString()}`);
                smppClient.submit_sm({
                    source_addr: soleSource,
                    destination_addr: soleDestination,
                    short_message: soleMessage,
                    data_coding: encoding,

                }, (pdu) => {
                    if (pdu.command_status === 0) {
                        logger.info(`Message sent successfully`);
                        fs.appendFileSync(file, `Delivery status: Success\n\n`);

                        fs.appendFileSync(file, `**Load Test Summary**\n`);

                        logger.info(`Initiating load test on SMPP server. Timestamp: ${new Date().toISOString()}`);
                        startSendingMessages();
                  
                    } else {
                        fs.appendFileSync(file, `Delivery status: Failed with code: ${pdu.command_status}\n\n`);
                        
                        logger.error(`Failed to send message with code: ${pdu.command_status}`);
                        smppClient.unbind();
                    }
                });

            } else {
                logger.error(`Failed to bind to SMPP server: ${pdu.command_status}`);
                fs.appendFileSync(file, `Bind Status: Failed to bind to the SMPP server\n\n`);
            }
        });
    });

    smppClient.on('error', (error) => {
        fs.appendFileSync(file, `SMPP connection: Failed\n`);
        fs.appendFileSync(file, `SMPP failed cause: ${error}\n`);
        logger.error(`SMPP session error: ${error}`);
    });

    smppClient.on('close', () => {
        fs.appendFileSync(file, `SMPP close time: ${new Date().toISOString()}\n`);
       
        logger.info('SMPP session closed');
    });

    smppClient.on('deliver_sm', (pdu) => {
        smppClient.send(pdu.response());
    });

    rl.close();
});

const createSubmitSmPromise = (count, dest, src, message, session) => {
    return new Promise((resolve, reject) => {
        session.submit_sm({
            destination_addr: dest,
            source_addr: src,
            short_message: `${count}.${message}`
        }, (pdu) => {
            if (pdu.command_status === 0) {
                // console.log(`Message ${count} successfully sent`);
                resolve();
            } else {
                // console.log(`Failed to send message ${count}`);
                reject(`Message ${count} failed with status ${pdu.command_status}`);
            }
        });
    });
};

function getTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    return `[${hours}:${minutes}:${seconds}.${milliseconds}]`;
}

function isChinese(text) {
    // Check if the text contains Chinese characters
    const chineseRegex = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/;
    return chineseRegex.test(text);
}

function splitMessage(message, maxLength) {
    const segments = [];
    let currentPosition = 0;

    while (currentPosition < message.length) {
        segments.push(message.substring(currentPosition, currentPosition + maxLength));
        currentPosition += maxLength;
    }

    return segments;
}
