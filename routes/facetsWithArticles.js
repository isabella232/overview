const express = require('express');
const router = express.Router();
const article = require('../modules/article');


// paths
router.get('/', async (req, res, next) => {
	res.render("facetsWithArticles");
});

router.get('/test', async (req, res, next) => {
	const results = await article.getArticleRelations( 1 );
	res.render("facetsWithArticles/test", { facetsJson: JSON.stringify(results) } );
});

router.get('/clusteredImages/:template/:facet', async (req, res, next) => {
	const results = await article.getArticleRelations(1);
	if(req.params.template.startsWith('five') || req.params.template === 'six'){
		data = results.breakdown.splice(0, 3);
	} else {
		data = results.breakdown.splice(0, 1);
	}
	res.render(`facetsWithArticles/clusteredImages/${req.params.template}`, {data: data});
});

router.get('/charts/:template/:facet/:days', async (req, res, next) => {
	const results = await article.getArticleRelations(req.params.days);
	const data = [];
	let maxitems = 10;

	for(let i = 0; i < results.breakdown.length; i++){
		if(results.breakdown[i].facet == req.params.facet){
			data.push(results.breakdown[i]);
		}
		if(data.length >= maxitems){
			break;
		}
	}

	res.render(`facetsWithArticles/charts/${req.params.template}`, {
		data: JSON.stringify(data),
		facet: req.params.facet
	});
});

router.get('/articlesAggregation/visual_1', async (req, res, next) => {
	const days = ( req.query.days ) ? req.query.days : 1;
	const results = await article.getArticlesAggregation( days );

	const genreNews = results.aggregationsByGenre['genre:genre:News'];
	const topics = genreNews.correlationAnalysis.primaryTheme.topics;
	let data = topics.map(topic => { return { name: topic[0] }; } );

	data.forEach(topic => {
		const articlesIDs = genreNews.articlesByMetadataCsv[`primaryTheme:topics:${topic.name}`];

		topic['articles'] = articlesIDs.map(article => {
			return genreNews.articlesByUuid[article];
		});

		topic['articles'] = topic['articles'].splice(0,2);
	});

	data = data.splice(0,3);

	res.render("facetsWithArticles/articlesAggregation/visual_1", {
		data: data,
		days: days
	} );
});


// endpoints
router.get('/relatedContent', async (req, res, next) => {
	const days = ( req.query.days ) ? req.query.days : 1;
	const facet = ( req.query.facet ) ? req.query.facet : 'topics';
	let aspects = ( req.query.aspects ) ? req.query.aspects : undefined;

	if(aspects){ aspects = aspects.split(',') }

	const results = await article.getArticleRelations( days );

	res.setHeader("Content-Type", "application/json");
	res.json( results );
});

router.get('/articlesAggregation', async (req, res, next) => {
	const days = ( req.query.days ) ? req.query.days : 1;
	const facet = ( req.query.facet ) ? req.query.facet : 'topics';
	let aspects = ( req.query.aspects ) ? req.query.aspects : undefined;

	if(aspects){ aspects = aspects.split(',') }

	const results = await article.getArticlesAggregation( days );
	res.json( results );
});





module.exports = router;
