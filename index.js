/* eslint-env node */
"use strict";

var AWS = require("aws-sdk");
var gm = require("gm").subClass({
	imageMagick: true
});
var util = require("util");

var dimensions = {
	avatars: [
		[24, 24],
		[48, 48],
		[64, 64],
		[96, 96],
		[128, 128]
	],
	banners: [
		[540, 180],
		[540, 360],
		[1080, 360],
		[1620, 360]
	],
	content: [
		[480, 960]
	]
};

function resize(where, image, width, height, done) {
	if (where !== "content") {
		gm(image)
			.resize(width, height, "^")
			.gravity("center")
			.crop(width, height)
			.toBuffer("jpg", done);
	} else {
		gm(image)
			.resize(width, height)
			.gravity("center")
			.toBuffer("jpg", done);
	}
}

function createParallelTask() {
	var tasks = 0, callback, error = false;
	return {
		start: function () { tasks++; },

		done: function (err) {
			tasks--;
			error = error || err;
			if(callback && tasks === 0) {
				callback(error);
				callback = null;
			}
		},

		onComplete: function (fn) {
			if(tasks === 0) {
				callback(error);
			} else {
				callback = fn;
			}
		}
	};
}


exports.handler = function(event, context) {
	var s3 = new AWS.S3(),
		bucket = event.Records[0].s3.bucket.name,
		key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")),
		keyParts = key.split("/"),
		uploadType = keyParts[1],
		source = keyParts.shift(),
		filename = keyParts.pop();

	console.log("Received event:\n", util.inspect(event, {
		depth: 5
	}));

	if(source !== "uploaded") {
		return context.fail("Skipping non-upload: " + key);
	}


//	console.log(filename.split(".").pop().toLowerCase());
	if (["jpg", "jpe", "jpeg", "gif", "png"].indexOf(filename.split(".").pop().toLowerCase()) < 0) {
		return context.fail("Skipping non-image: " + key);
	}

	console.log("Fetching object:");
	s3.getObject({ Bucket: bucket, Key: key }, function(getErr, response) {
		if (getErr) { return context.fail("getObject failed for " + key + " : " + getErr); }

		var task = createParallelTask();

		dimensions[uploadType].forEach(function(dim) {
			task.start();
			resize(uploadType, response.Body, dim[0], dim[1], function(resizeErr, buffer) {
				if (resizeErr) {
					console.log("resize failed for " + key + " : " + dim.join("x") + " : " + resizeErr);
					return task.done(true);
				}

				s3.putObject({
					Bucket: bucket, Body: buffer, ContentType: "image/jpeg", ACL: "public-read",
					Key: "generated/" + keyParts.join("/") + "/" + dim[0] + "x" + dim[1] + ".jpg"
				}, function(uploadErr) {
					if (uploadErr) {
						console.log("upload failed for " + key + " : " + dim.join("x") + " : " + uploadErr, uploadErr);
						return task.done(true);
					}

					console.log("finished processing a thumbnail for " + key + " : " + dim.join("x"));
					task.done();
				});
			});
		});

		task.onComplete(function (err) {
			if (err) {
				context.fail("At least one resize or upload failed.");
			} else {
				context.succeed("All resizes and uploads were successful.");
			}
		});
	});
};
