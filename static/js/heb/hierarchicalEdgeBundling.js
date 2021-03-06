class HierarchicalEdgeBundlingDiagram {

	constructor(){
		this.links = null;
		this.nodes = null;
		this.filter = null;
		this.itemList = [];
	}

	init(data, target){
		this.scp = this;
		this.datum = this.prepData(data);
		this.datumTarget = target;
	}

	draw(facets, filter = null){
		this.facets = facets;
		this.filter = filter;

		if(facets.length > 0){
			this.start();
		} else {
			this.removeDiagram();
		}
	}

	refreshDiagram(){
		this.removeDiagram();
		this.start();
	}

	removeDiagram(){
		var svg = document.getElementsByTagName('svg')[0];
		if(svg){
			svg.parentNode.removeChild(svg);
		}
	}

	prepData(data){
		var reformatted = [];
		var parsed = JSON.parse(this.formatStr(data));

		parsed.breakdown.forEach(facet => {
			var newObj = this.newNodeObj(facet.facet, facet.facetName);
			newObj.size = this.calcSize(facet);
			newObj.imports = this.addImports(facet);
			reformatted.push(newObj);
		});

		return reformatted;
	}

	formatStr(str){
		return str.replace(/&quot;&gt;/g, '>')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&');
	}

	newNodeObj(facet, name = "name"){
		return {
			"name": "flare." + facet + '.' + this.sanatiseStr(name),
			"size": 0,
			"imports": [],
		};
	}

	calcSize(facet){
		return facet.articleCount + facet.relatedTopicCount.length + facet.relatedPeopleCount.length + facet.relatedOrgsCount.length;
	}

	sanatiseStr(str){
		return str.replace(/\./g, ' ').replace(/&#x27;/g, '\'');
	}

	addImports(facet){
		var topics = this.extractImports('topics', facet.relatedTopicCount);
		var people = this.extractImports('people', facet.relatedPeopleCount);
		var orgs = this.extractImports('organisations', facet.relatedOrgsCount);
		var genre = this.extractImports('genre', facet.relatedGenreCount);
		return [].concat(topics, people, orgs, genre);
	}

	extractImports(type, data){
		var extracts = [];
		data.forEach(item => {
			extracts.push("flare." + type + "." + this.sanatiseStr(item.name));
		});
		return extracts;
	}

	getItems(){
		return this.itemList;
	}

	filterData(data){
		var filtered = [];
		this.itemList = [];

		this.datum.forEach(item => {
			var nameSplit = item.name.split('.');
			var facet = nameSplit[1];

			if(this.facets.indexOf(facet) >= 0){

				if(this.filter !== null){
					var itemSplit = this.filter.split('.');
					var shortname = itemSplit[itemSplit.length - 1];

					if(item.key === shortname || item.imports.includes(this.filter)){
						filtered.push(item);
						this.itemList.push(item.name);
					}
				} else {
					filtered.push(item);
					this.itemList.push(item.name);
				}

			}
		});

		return filtered;
	}

	start(){
		var wWidth = window.innerWidth;
		var wHeight = (window.innerHeight > 600) ? window.innerHeight : 600;
		var innerRadius = (wWidth > wHeight) ? (wHeight / 2) - 170 : (wWidth / 2) - 170;

		var cluster = d3.cluster()
			.size([360, innerRadius]);

		var line = d3.radialLine()
			.curve(d3.curveBundle.beta(0.85))
			.radius(function(d) { return d.y; })
			.angle(function(d) { return d.x / 180 * Math.PI; });

		var svg = d3.select("main").append("svg")
			.attr("width", wWidth)
			.attr("height", wHeight)
			.append("g")
			.attr("transform", "translate(" + wWidth / 2 + "," + ((wHeight / 2) - 20) + ")");

		var link = svg.append("g").selectAll(".link");
		var node = svg.append("g").selectAll(".node");

		var filterdData = this.filterData(this.datum);

		var root = packageHierarchy(filterdData)
			.sum(function(d) { return d.size; });

		cluster(root);

		link = link
			.data(packageImports(root.leaves()))
			.enter().append("path")
			.each(function(d) {
				d.source = d[0], d.target = d[d.length - 1];
			})
			.attr("class", "link")
			.attr("d", line);

		this.link = link;

		node = node
			.data(root.leaves())
			.enter().append("text")
			.attr("id", function(d) { return d.data.key; })
			.attr("class", function(d) { return "node " + d.data.parent.key; })
			.attr("dy", "0.31em")
			.attr("transform", function(d) { return "rotate(" + (d.x - 90) + ")translate(" + (d.y + 8) + ",0)" + (d.x < 180 ? "" : "rotate(180)"); })
			.attr("text-anchor", function(d) { return d.x < 180 ? "start" : "end"; })
			.text(function(d) { return d.data.key; })
			.on("mouseover", mouseovered)
			.on("mouseout", mouseouted);

		this.node = node;


		function mouseovered(d) {
			node
				.each(function(n) { n.target = n.source = false; });

			link
				.classed("link--target", function(l) {
					if (l.target === d) {
						l.source.source = true;
						return true;
					} 
				})
	      		.filter(function(l) { return l.target === d || l.source === d; })
	      		.raise();

	      	node
		      .classed("node--target", function(n) { return n.target; })
		      .classed("node--source", function(n) { return n.source; });
		}

		function mouseouted(d) {
			link
				.classed("link--target", false);

			node
      			.classed("node--target", false)
      			.classed("node--source", false);
		}


		// Lazily construct the package hierarchy from class names.
		function packageHierarchy(classes) {
			var map = {};

			function find(name, data) {
				var node = map[name], i;
				if (!node) {
					node = map[name] = data || {name: name, children: []};
					if (name.length) {
						node.parent = find(name.substring(0, i = name.lastIndexOf(".")));
						node.parent.children.push(node);
						node.key = name.substring(i + 1);
					}
				}
				return node;
			}

			classes.forEach(function(d) {
				find(d.name, d);
			});

			return d3.hierarchy(map[""]);
		}

		// Return a list of imports for the given array of nodes.
		function packageImports(nodes) {
			var map = {};
			var imports = [];

			nodes.forEach(function(d) {
				map[d.data.name] = d;
			});

			nodes.forEach(function(d) {
				if (d.data.imports){
					d.data.imports.forEach(function(i) {
						if(map[i]){
							imports.push(map[d.data.name].path(map[i]));
						}
					});
				}
			});

			return imports;
		}
	}
}