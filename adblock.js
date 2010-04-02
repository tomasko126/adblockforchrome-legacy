infinite_loop_workaround("adblock");

// Don't inspect past this far into a URL, because it makes for some
// painful regexes.
var LENGTH_CUTOFF = 200;

var domain = document.domain;

function Matcher(filters) {
  this.filters = filters;

  var regexes = add_includes_and_excludes(filters.whitelisted_src_regexes);
  for (var i = 0; i < regexes.length; i++)
    regexes[i] = new RegExp(regexes[i]);
  this.compiled_whitelisted_regexes = regexes;

  regexes = add_includes_and_excludes(filters.src_regexes);
  for (var i = 0; i < regexes.length; i++)
    regexes[i] = new RegExp(regexes[i]);
  this.compiled_regexes = regexes;

  this.whitelisted_substrings = add_includes_and_excludes(
          filters.whitelisted_src_substrings);
  this.substrings = add_includes_and_excludes(
          filters.src_substrings);

}
// Return true if 'target' matches any of 'patterns'.
Matcher.prototype.matches = function(target, patterns, is_regex) {
  // Avoid realllly slow checking on huge strings -- google
  // image search results being one example.
  target = target.substring(0, LENGTH_CUTOFF);

  for (var i = 0; i < patterns.length; i++) {
    if ( (!is_regex && this.substring_match(patterns[i], target)) ||
         ( is_regex && this.regex_match(patterns[i], target)) ) {
      log("  * " + (is_regex ? "regex" : "substring") + " match: '" + 
          patterns[i] + "' matches '" + target + "'");
      return true;
    }
  }
  return false;
}
// Split out for profiling's sake.
Matcher.prototype.substring_match = function(pattern, target) {
  // See matches() for reason
  pattern = pattern.substring(0, LENGTH_CUTOFF);

  return target.indexOf(pattern) != -1;
}
// TODO: see dev/TODO -- this is slow.  Speed it up.
Matcher.prototype.regex_match = function(pattern, target) {
  return pattern.test(target);
}
// Return a jQuery object containing all [src] and [value] elements that
// match one of the given regex (if is_regex) or substring patterns.
Matcher.prototype.get_url_matches = function(patterns, is_regex) {
  var result = $([]);
  var that = this;

  log("SRC matches:");
  result = $("[src]").
    filter(function(i) {
        if (this.src == undefined) // e.g. <span src="foo"/> does this
          return false;
        return that.matches(this.src.toLowerCase(), patterns, is_regex);
      });

  log("OBJECT PARAM matches:");
  $("object param[value]").
    filter(function(i) {
        if (this.value == undefined)
          return false;
        return that.matches(this.value.toLowerCase(), patterns, is_regex);
      }).
    each(function(i, el) {
        result = result.add($(el).closest("object"));
      });

  return result;
}
// Return true if the given string is matched by our filters.
Matcher.prototype.is_matched = function(value) {
  value = value.toLowerCase();
  var answer = false;
  if (this.matches(value, this.compiled_regexes, true))
    answer = true;
  else if (this.matches(value, this.substrings, false))
    answer = true;

  if (answer == true) { // check that they're not whitelisted
    if (this.matches(value, this.compiled_whitelisted_regexes, true))
      return false;
    if (this.matches(value, this.whitelisted_substrings, false))
      return false;
  }

  return answer;
}
// Return a jQuery object containing all [src] and [value] elements that
// match the given regex and substring lists of filters.
Matcher.prototype.get_regex_and_substring_matches = function(isWhitelist) {

  var regexes, substrings;

  if (isWhitelist) {
    regexes = this.compiled_whitelisted_regexes;
    substrings = this.whitelisted_substrings;
  } else {
    regexes = this.compiled_regexes;
    substrings = this.substrings;
  }

  // TODO: we call this twice?!  So we have to find and filter these
  // elements twice?!  Why not call it once, pass it a regex and a
  // substring list, and check the substrings first, and then the
  // regexes if still not matched, and I can't imagine that won't
  // be faster.
  // And while you're at it, get rid of is_matched().  Can you roll
  // bg-image checking into get_url_matches?
  var result = this.get_url_matches(regexes, true);

  var substring_matches = this.get_url_matches(substrings, false);

  result = result.add(substring_matches);

  return result;
}


function adblock_begin_v2(features) {

  // Remove <embed> tags hidden by selector-based rules, so Flash objects
  // don't take up CPU.
  function remove_embeds_by_selector(f, whitelisted) {
    var selectors = add_includes_and_excludes(f.selectors);
    // Only apply the selectors to <embed> tags, because we only want to
    // remove Flash.  Grab their parent <object> tags while we're at it.
    var embedded_ads = $("embed").find(selectors.join(',')).not(whitelisted);
    var object_parents = embedded_ads.parent().find('[nodeName="OBJECT"]');

    embedded_ads.add(object_parents).remove();
  }

  // Run special site-specific code.
  function run_specials() {
    var domain = document.domain;

    if (domain.indexOf("chess.com") != -1) {
        // Their sucky HTML coders absolutely positioned the search box,
        // so blocking the top ad makes the search box appear too low on the
        // page.
        var search_form = $("#search_form").closest("div");
        search_form.css("top", "40px");
    }

    if (domain.indexOf("honestjohn.co.uk") != -1) {
      $(".sponsads1").closest(".pane").remove();
    }
    
    if (domain.indexOf("cbssports.com") != -1) {
        $("body").css("background-image", "url()");
    }

    if (domain.indexOf("songmeanings.net") != -1) {
        $("#rm_container").remove();
        $("body").css("overflow", "auto");
    }

    if (domain.indexOf("newgrounds.com") != -1) {
        $("div#main").css('background-image', '');
    }

    if (domain.indexOf("99.se") != -1) {
        $('div[id*="Banner"]').html("");
    }

    if (domain.indexOf("vanguard.com") != -1) {
        // Remove broken lack-of-JS check
        $(".hidePageIfJSdisabled").removeClass("hidePageIfJSdisabled");
    }

    if (domain.indexOf("imdb.com") != -1) {
        $("#top_ad_wrapper").remove(); // in case they aren't on EasyList
        $("#navbar").css('margin-top', 21);
    }

    if (domain.match("youtube") && features.block_youtube.is_enabled) {
      // Based heavily off of AdThwart's YouTube in-video ad blocking.
      // Thanks, Tom!
      function adThwartBlockYouTube(elt) {
        elt = elt || $("#movie_player").get(0);
        if (!elt)
          return;
        log("Blocking YouTube ads");

        var origFlashVars = elt.getAttribute("flashvars");
        // In the new YouTube design, flashvars could be in a <param> child node
        var inParam = false;
        if(!origFlashVars) {
            origFlashVars = elt.querySelector('param[name="flashvars"]');
            // Give up if we still can't find it
            if(!origFlashVars)
                return;
            inParam = true;
            origFlashVars = origFlashVars.getAttribute("value");
        }
        // Don't mess with the movie player object if we don't actually find any ads
        var adCheckRE = /&(ad_|prerolls|invideo|interstitial).*?=.+?(&|$)/gi;
        if(!origFlashVars.match(adCheckRE))
            return;
        // WTF. replace() just gives up after a while, missing things near the end of the string. So we run it again.
        var re = /&(ad_|prerolls|invideo|interstitial|watermark|infringe).*?=.+?(&|$)/gi;
        var newFlashVars = origFlashVars.replace(re, "&").replace(re, "&") + "&invideo=false&autoplay=1";
        var replacement = elt.cloneNode(true); // Clone child nodes also
        // Doing this stuff fires a DOMNodeInserted, which will cause infinite recursion into this function.
        // So we inhibit it using have_blocked_youtube.
        have_blocked_youtube = true;
        if(inParam) {
            // Grab new <param> and set its flashvars
            newParam = replacement.querySelector('param[name="flashvars"]');;
            newParam.setAttribute("value", newFlashVars);
        } else {
            replacement.setAttribute("flashvars", newFlashVars);
        }
        elt.parentNode.replaceChild(replacement, elt);

        if (features.show_youtube_help_msg.is_enabled) {
          var disable_url = chrome.extension.getURL("options.html");
          var message = $("<div>").
            css({"font-size": "x-small", "font-style": "italic",
                 "text-align": "center", "color": "black",
                 "font-weight": "normal", "background-color": "white"}).
            append("<span>No video?  Reload the page.  If this happens a lot, disable YouTube ad blocking under <a target='_new' href='" + disable_url + "'>AdBlock Options</a>.</span>");
          var closer = $("<a>", {href:"#"}).
            css({"font-style":"normal", "margin-left":"20px"}).
            text("[x]").
            click(function() {
              message.remove();
              extension_call(
                "set_optional_feature",
                {name: "show_youtube_help_msg", is_enabled: false}
              );
            });
          message.append(closer);
          $("#movie_player").before(message);
        }

        // It seems to reliably make the movie play if we hide then show it.
        // Doing that too quickly can leave the Flash player in place but
        // entirely white (and I can't figure out why.)  750ms seems to work
        // and is quick enough to not be bothersome; and the message we
        // display should handle it even if this turns out to not work all
        // of the time.
        $("#movie_player").hide();
        window.setTimeout(function() { $("#movie_player").show(); }, 750);
      }
      // movie_player doesn't appear in the originally loaded HTML, so I
      // suspect it is inserted right after startup.  This code may not be
      // needed (when I remove it ads are still removed) but I'll leave it
      // in to be safe.
      have_blocked_youtube = false;
      document.addEventListener("DOMNodeInserted", function(e) {
        if (e.target.id == "movie_player") {
          if (!have_blocked_youtube) { // avoid recursion
            adThwartBlockYouTube(e.target);
          }
        }
      }, false);
      adThwartBlockYouTube();
    }

  }

  // TODO: opts code copied from adblock_start.js
  var opts = {};
  if (window == window.top)
    opts.top_frame_domain = document.domain;

  cached_extension_call('get_user_demands_v2', opts, function(demands) {
    var start = new Date();
    log("==== ADBLOCKING PAGE: " + document.location.href);

    // Do nothing if we're whitelisted.
    if (page_is_whitelisted(demands.whitelist, demands.top_frame_domain)) {
      // We need to kill the listeners on every frame, but we'll have to
      // make do with just this frame.
      stop_checking_for_blacklist_keypress();
      stop_checking_for_whitelist_keypress();
      return;
    }

    // GMail is already handled in adblock_start.
    if (document.domain == "mail.google.com")
      return;

    var matcher = new Matcher(demands.filters);

    // TODO: this doesn't actually work half the time, because Chrome has two
    // conflicting directives.  Really I need to make :not(.adblock_innocent)
    // be on every freaking rule, or remove the elements then remove the
    // injected <style> tag.
    // Also, this won't address items that load after adblock.js runs, but I've
    // never had a complaint about it.
    log("Matching whitelisted elements by regex or substring.");
    var whitelisted = matcher.get_regex_and_substring_matches(true);
    whitelisted.show();

    log("Matching elements by regex or substring.");
    matcher.get_regex_and_substring_matches(false).not(whitelisted).remove();

    // CSS hides all items matched by selector rules (and whitelisted
    // items are then explicitly show()n above.)  
    if (features.debug_logging.is_enabled) {
      log("Items matched by adblock_start CSS (excluding whitelisted):");
      var selectors = add_includes_and_excludes(demands.filters.selectors);
      for (var i = 0; i < selectors.length; i++) {
        var dead = $(selectors[i]).not(whitelisted);
        for (var j = 0; j < dead.length; j++) {
          log("  * css '" + selectors[i].substring(0,80) + "' matches '" + 
              $(dead[j]).html().substring(0,80).replace(/\n/g, '') + "...'");
        }
      }
    }
    // However, we want to actually remove <embed> objects so Flash
    // doesn't take up CPU.
    // TODO: actually, this takes lots of time, so don't do it.
    //remove_embeds_by_selector(demands.filters, whitelisted);

    // TODO: this doesn't match <div> background-images, which we had to
    // special-case in run_specials().  Better would be something like
    // $("has-css:background-image").filter(by regex).css("bgimage", null);
    // Is there such a thing as has-css or its ilk? (I'm on a plane right now.)
    // If so, is it fast?  I don't want to have to touch every freaking
    // element.  Maybe $("body,div").filter(has bgimage matching regex)
    // would be better -- either way, profile it.
    // Remove background images
    var bgimage_css = $("body").css("background-image") || "";
    // "" if no <body> -- e.g. if in a <frameset>
    var bgimage = bgimage_css.match(/^url\((.*)\)$/);
    if (bgimage) {
      log("BACKGROUND IMAGE");
      var bg_url = bgimage[1];
      if (matcher.is_matched(bg_url))
        $("body").css("background-image", null);
    }


    run_specials();

    var end = new Date();
    time_log("Total running time (v2): " + (end - start) + " || " +
             document.location.href);


    _done_with_cache("adblock");
  });
}

listen_for_broadcasts();
blacklister_init();
whitelister_init();

cached_extension_call('get_optional_features', {}, function(features) {
  adblock_begin_v2(features);
});
