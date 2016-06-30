/* eslint-env node */
"use strict";

const AWS = require('aws-sdk');
const gm = require('gm').subClass({ imageMagick: true });
const config = require('./config');
const dimensions = {
	a: [16, 24, 32, 48, 64, 72, 96, 128, 256, 320, 480, 512, 640, 960],
	b: [120, 240, 320, 480, 640, 960],
	c: [120, 240, 320, 480, 640, 960]
};

exports.handler = (event, context, callback) => {
	const s3 = new AWS.S3();
	const bucket = event.Records[0].s3.bucket.name;
	const destinationBucket = config.bucketName;
	const keyLocationInBucket = event.Records[0].s3.object.key;
	const splittedKeyLocation = keyLocationInBucket.split("/");
	const imageType = splittedKeyLocation[0];
	const keyLocationInDestinationBucket = splittedKeyLocation.slice(0, splittedKeyLocation.length-1).join("/");

	const resize = (imageType, imageBuffer, width, height, next) => {
		if (imageType === "a") {
			gm(imageBuffer)
				.resize(width)
				.gravity("center")
				.crop(width, height)
				.toBuffer('JPG', next);
		} else {
			gm(imageBuffer)
				.resize(width)
				.gravity("center")
				.toBuffer('JPG', next);
		}
	};

	const getObjectFromS3 = () => {
		return new Promise((resolve, reject) => {
			s3.getObject({
				Bucket: bucket,
				Key: keyLocationInBucket
			}, (err, data) => {
				if (err) {
					reject("someting went wrong while getting the uploaded image: " + err);
				} else {
					resolve(data);
				}
			});
		});
	};

	const putObjectToS3 = (body) => {
		const imageResizePromises = [];

		dimensions[imageType].forEach((dimension) => {
			imageResizePromises.push(
				new Promise((resolve, reject) => {
					resize(imageType, body, dimension, dimension, function(err, responseBuffer) {
						if (err) {
							reject("something went wrong while resizing image to " + dimension + ": " + err);
						} else {
							console.log("Done resizing image to dimension: " + dimension);
							resolve([responseBuffer, dimension]);
						}
					});
				})
			);
		});

		Promise.all(imageResizePromises)
			.then((promises) => {
				// resizedImageAndDimension => Type: Object(Array)  Format: [ImageBuffer, Dimension(Integer)]
				promises.forEach((resizedImageAndDimension) => {
					s3.putObject({
						Bucket: destinationBucket,
						Key: keyLocationInDestinationBucket + "/" + resizedImageAndDimension[1] + '.jpeg',
						Body: resizedImageAndDimension[0]
					}, (err, data) => {
						if (err) {
							console.log("something went wrong while uploading image of dimension " + resizedImageAndDimension[1] + ": " + err);
						} else {
							console.log("Done uploading resized image of dimension: " + resizedImageAndDimension[1]);
							console.log(data);
						}
					});
				});
			})
			.catch((err) => {
				console.log(err);
			});
	};

	getObjectFromS3()
		.then((data) => {
			console.log(data);
			putObjectToS3(data.Body);
		})
		.catch((err) => {
			console.log(err);
		});
}