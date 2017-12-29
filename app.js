var request = require('request');
var cheerio = require('cheerio');
var cloudscraper = require('cloudscraper');
var express = require('express');
var Promise = require('promise');
var fs = require('fs');
var jsonfile = require('jsonfile');
var Cloudant = require('cloudant');
var DiscoveryV1 = require('watson-developer-cloud/discovery/v1');
var app = express();

// Config file
config = jsonfile.readFileSync( __dirname + '/config.json' );
app.use(function (req, res, next){
  req.config = config;
  next();
});

// Connect to cloudant
var cloudantURL = process.env.CLOUDANT_URL;
console.log(cloudantURL);
var cloudant = Cloudant(cloudantURL, function(er, cloudant, reply) {
  if (er) {
    throw er;
  }
  console.log('Connected with username: %s', reply.userCtx.name);
  cloudant.db.list(function(err, allDbs) {
    console.log('All my databases: %s', allDbs.join(', '))
  });

  // existingCloudantDoc('123').then(function (result) {
  //   if (result) {
  //     console.log("scraping first page");
  //   }
  //   else {
  //     console.log("scrape every review");
  //   }
  // });
  existingCloudantDoc('1234').then(function (result) {
    if (result) {
      console.log("document exists");
      console.log("scraping first page");
    }
    else {
      var dataModel = {
        _id: '1234',
        productName: 'Coffee Press',
        reviews: [{reviewer: 'John', text: 'Useful', rating: '5'}]
      };
      mydb.insert(dataModel, function (error, result) {
        console.log(result);
      })
      console.log("scraped every review");
    }
  });
});
var mydb = cloudant.db.use("products");

// Review URL template
var review_url = "https://www.amazon.com/product-reviews/";
var review_page = "/ref=cm_cr_arp_d_paging_btm_2?pageNumber=";

app.use(require('body-parser').json());




var discovery = new DiscoveryV1({
  username: config.discoveryUsername,
  password: config.discoveryPassword,
  version_date: '2017-11-07'
});

//serve static file (index.html, images, css)
app.use(express.static(__dirname + '/public'));

app.get('/reviews/:reviewId', function(req, res) {
  var _arrayOfReviews = [];

  //number of pages
  cloudscraper.get(review_url + req.params.reviewId + review_page + 1, function(error, response, body) {
    if (error) {
        return console.error(error);
    } else {
      var pageList = [];
      var $ = cheerio.load(body);
      $("li[class='page-button']").each(function(i, element){
          pageList.push(parseInt($(this).text()));
      });
      var numberOfPages = pageList.pop();
      console.log($("title").text());
      scrapeEveryPage(numberOfPages, _arrayOfReviews, req.params.reviewId).then(function (options) {
          res.send(options);
      });
    }
  });
});

var port = process.env.PORT || 4000
app.listen(port, function() {
  console.log("Oder API service is in port: " + port);
});

function scrapeEveryPage(totalPages, arrayOfReviews, productId) {
  return new Promise(function (resolve,reject) {
    var totalReviews = 0;
    var completedRequests = 0;
    for(page = 1; page < totalPages+1; page++) {
      cloudscraper.get(review_url + productId + review_page + page, function(error, response, body) {
        if (error) {
          console.log('Error occurred');
          reject(error);
        } else {
          var title = [];
          var review = [];
          var author = [];
          var authorLink = [];
          var rating = [];

          var $ = cheerio.load(body);

          $("a[class='a-size-base a-link-normal review-title a-color-base a-text-bold']").each(function(i, element) {
              // console.log((i) + '==>' + $(this).text());
              title.push($(this).text());
          });
          $("span[class='a-size-base review-text']").each(function(i, element) {
              // console.log((i) + '==>' + $(this).text());
              review.push($(this).text());
          });
          $("a[class='a-size-base a-link-normal author']").each(function(i, element) {
              // console.log((i) + '==>' + $(this).text() + ' ' + $(this).attr('href'));
              author.push($(this).text());
              authorLink.push($(this).attr('href'));
          });
          var lengthFound = $("span[class='a-icon-alt']").length;
          $("span[class='a-icon-alt']").each(function(i, element) {
              var ratingFound = $(this).text();
              if (i == 0 || i == 1 || i == 2 || i == 3 || ratingFound == "|" || i == (lengthFound - 5) || i == (lengthFound - 4) || i == (lengthFound - 3) || i == (lengthFound - 2) || i == (lengthFound - 1)) {

              }
              else {
                ratingFound = ratingFound.replace('.0 out of 5 stars','');
                rating.push(ratingFound);
              }
          });
          for(i = 0; i < title.length; i++) {
            var JSONObjectReview = {reviewer:'',text:'',title:'',rating:''};
            JSONObjectReview.reviewer = author[i];
            JSONObjectReview.text = review[i];
            JSONObjectReview.title = title[i];
            JSONObjectReview.rating = rating[i];
            arrayOfReviews.push(JSONObjectReview);
          }

          completedRequests++;
          totalReviews += title.length;

          if (completedRequests == totalPages) {
            console.log('Total reviews parsed: ' + totalReviews);
            // watsonAddDocument(arrayOfReviews).then(discoveryQuery);
            resolve(JSON.stringify(arrayOfReviews));
          }

        }
      });
    }
  });
}
// {
// "productName": "Amazon Echo",
// "_id": "B1234AB",
// "reviews": [{
//             "name": "John Doe",
//             "title": "Great Product!",
//             "text": "This product is cool.",
//             "rating": "5.0"
//             },{
//             "name": "Jane Doe",
//             "title": "Meh",
//             "text": "Meh.",
//             "rating": "4.0"
//             },{
//
//             }],
// "averageStarRating": "4.7",
// }

function existingCloudantDoc(productId) {
  return new Promise(function (resolve, reject) {
    mydb.find({selector:{_id: productId}}, function (error, result) {
      if (error) {
        console.log(error);
      }
      else {
        console.log(result.docs.length);
        console.log(result.docs);
        resolve(result.docs.length > 0);
      }
    });
  });
}

function watsonAddDocument(reviews) {
  var promise = new Promise(function (resolve,reject) {
    var docs = 0;
    var errorFlag = false;
    for (var i = 0; i < reviews.length; i++) {

      discovery.addJsonDocument({
        environment_id: config.environment_id,
        collection_id: config.collection_id,
        file: reviews[i]
      }, function(error, data) {
        if(error) {
            errorFlag = true;
            console.log('addDocErr: ')
            console.log(error)
        } else {
          docs++;
          console.log('document status: ')
          console.log(data)
          if (docs === 2) {
            setTimeout(function(){ resolve(data)}, 10000);
          }
        }
      });
    }
  });
  return promise;
}

function discoveryQuery() {
  var promise = new Promise(function (resolve,reject) {

    var query = '';

    var queryUrl = 'https://gateway.watsonplatform.net/discovery/api/v1/'
    + 'environments/' + config.environment_id + '/'
    + 'collections/' + config.collection_id + '/'
    + 'query?query=' + query + '&count=10&version=2017-11-07'

    request.get({
      url: queryUrl,
      version_date: '2017-11-07',
      auth: {
          user: config.discoveryUsername,
          pass: config.discoveryPassword
      }
    }, function(err, response, body) {
      if (err) {
        reject('there is an error in the query')
      } else {
        resolve('query worked')
      }
      console.log('Query Results: \n' + body);
    });
  });
  return promise;
}
